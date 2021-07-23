const Discord = require('discord.js');
const mongoose = require('mongoose');
const {DiscordInteractions} = require("slash-commands");

const M = require('./model');
const C = require('./config');

const {
    fetchData,
    generateData,
    generateEmbed,
    convertToSlug,
    titleCase,
    globalCommandData,
} = require('./utils');


console.log("CONFIG: " + JSON.stringify(C));

const client = new Discord.Client({intents: ['GUILDS', 'GUILD_MESSAGES']});
const discordInteractions = new DiscordInteractions({
    applicationId: C.DISCORD_APP_ID,
    authToken: C.DISCORD_TOKEN,
    publicKey: C.DISCORD_PUB_KEY
})

const Guild = mongoose.model('Guild', M.DISCORD_GUILD);

mongoose.connect(C.MONGO_URL, {useNewUrlParser: true, useUnifiedTopology: true});

const db = mongoose.connection;

db.on('open', function ()
{
    console.log("Connected to mongo.");
    Guild.find({}).then(function (found)
    {
        console.log("Found " + found.length + " guilds");
    })
})

client.once('ready', async () =>
{
    // Check for global commands.
    let commandList = await discordInteractions.getApplicationCommands();
    if (commandList === undefined || commandList.length === 0 || commandList.length !== globalCommandData.length)
    {
        console.log("Global commands are out of date, installing")
        await client.application?.commands.set(globalCommandData);

        let commandList = await discordInteractions.getApplicationCommands();
        let currentCommands = ""
        commandList.forEach(c => currentCommands += JSON.stringify(c))
        console.log(currentCommands)
    }
    else
    {
        console.log("Commands have been installed already");
        console.debug(JSON.stringify(commandList))
    }

    console.log('Global command check complete, the bot is now online.');
    updateStatus();
    await dailyRefresh();

    // Check donations every n seconds (defined in config).
    setInterval(function ()
    {
        //console.debug("Checking for donations...")
        Guild.find({isActive: true}).then(function (allGuilds)
        {
            allGuilds.forEach(guild =>
            {
                guild.campaigns.filter(c => c.isActive).forEach(campaign =>
                {
                    console.debug("Checking for: " + campaign.tiltifyCampaignName);

                    let donation = fetchData('campaigns', `${campaign.tiltifyCampaignId}/donations`)
                    try
                    {
                        if (campaign.lastDonationId === 'undefined')
                            return
                        if (campaign.lastDonationId !== donation.data[0].id)
                        {
                            let embed = generateEmbed(campaign, donation.data[0])
                            client.channels.cache.get(guild.discordChannelId).send({embeds: [embed]})
                            campaign.lastDonationId = donation.data[0].id;
                            guild.save().then(() => updateStatus());
                        }
                    }
                    catch
                    {
                        console.log('There was an error reading donation data on ' + Date.toString());
                    }

                });
            })
        })
    }, C.DONATION_REFRESH)

    // Auto refresh data every 12 hours.
    setInterval(function ()
    {
        dailyRefresh()
    }, 60 * 60 * 1000 * 12);

    // Check and route a command.
    client.ws.on('INTERACTION_CREATE', async interaction =>
    {
        console.log("Interaction received: " +JSON.stringify(interaction));

        let isSetup = await Guild.exists({discordGuildId: interaction.guild_id});
        const guild = await Guild.findOne({discordGuildId: interaction.guild_id}).exec();

        switch (interaction.data.name)
        {
            case 'ping':
                pingPong(interaction, guild);
                break;
            case 'setup':
                await setupTiltify(interaction, guild);
                break;
            case 'tiltify':
                isSetup ? await startStopDonations(interaction, guild) : error(interaction, 0);
                break;
            case 'add':
                isSetup ? await addCampaign(interaction, guild) : error(interaction, 0);
                break;
            case 'remove':
                isSetup ? removeCampaign(interaction, guild) : error(interaction, 0);
                break;
            case 'list':
                isSetup ? await generateListEmbed(interaction, guild) : error(interaction, 0);
                break;
            case 'channel':
                isSetup ? await changeChannel(interaction, guild) : error(interaction, 0);
                break;
            case 'refresh':
                isSetup ? await refreshData(interaction, guild) : error(interaction, 0);
                break;
            case 'delete':
                isSetup ? await deleteData(interaction, guild) : error(interaction, 0);
                break;
            case 'find':
                isSetup ? await findCampaigns(interaction, guild) : error(interaction, 0);
                break;
        }
    });

    /**
     * Update the status message in Discord.
     */
    function updateStatus()
    {
        let numCampaigns = 0;
        Guild.find({}).then(function (guilds)
        {
            guilds.forEach(g => numCampaigns += g.campaigns.length);
        });
        client.user.setPresence({status: "online"});
        client.user.setActivity(numCampaigns + ' campaigns...', {type: "WATCHING"});
    }

    //
    /**
     * Check bot ping time
     * @param interaction
     */
    function pingPong(interaction)
    {
        respondToInteraction(interaction, '`' + (Date.now() - interaction.createdTimestamp) + '` ms');
    }

    // Initial bot setup. (/setup)
    /**
     * Initial setup for the discord guild.
     * @param interaction
     * @param guild
     * @returns {Promise<void>}
     */
    async function setupTiltify(interaction, guild)
    {

        if (await Guild.exists({discordGuildId: interaction.guild_id}))
        {
            console.log(`requesting guild Id: ${interaction.guild_id} - found`)
            await respondToInteraction(interaction, 'This server is already in the database, please use `/add` to add a campaign or `/delete` .')
            return;
        }

        guild = new Guild({discordGuildId: interaction.guild_id});

        let type_param = interaction.data.options.find(e => e.name === 'type')
        let id_param = interaction.data.options.find(e => e.name === 'id')


        let result = await fetchData(type_param.value, id_param.value)

        if (result.meta.status !== 200)
        {
            error(interaction, result.meta.status)
            return;
        }
        let number = 0;

        guild.discordGuildId = interaction.guild_id;
        guild.discordChannelId = interaction.channel_id;
        guild.campaigns = [];
        guild.isActive = false;
        guild.tiltifyType = type_param.value

        switch (type_param.value)
        {
            case 'campaigns':
                if (result.data.status === 'retired')
                {
                    await respondToInteraction(interaction, '`' + result.data.name + '` has already ended, please choose an active campaign.');
                    return;
                }
                guild.campaigns.push(generateData(result.data));
                guild.save().then(() => updateStatus());
                await respondToInteraction(interaction, 'Donations have been setup for campaign `' + result.data.name + '`.')

                break;
            case 'teams':
                if (result.data.disbanded)
                {
                    await respondToInteraction(interaction, '`' + result.data.name + '` has been disbanded, please choose an active team.');
                    return;
                }
                let teamData = await fetchData('teams', id_param.value + '/campaigns?count=100')
                if (teamData.meta.status === 200)
                {
                    for (const campaign of teamData.data)
                    {
                        if (campaign.status !== 'retired')
                        {
                            number++;
                            guild.campaigns.push(await generateData(campaign));
                        }
                    }
                    guild.save().then(() => updateStatus());
                    guild.connectedId = id_param.value;

                    await respondToInteraction(interaction, 'Donations have been setup for team `' + result.data.name + '`, ' + number + ' active campaigns were found.')
                    return;
                }
                error(interaction, result.meta.status)
                break;
            case 'causes':
                await respondToInteraction(interaction, 'Restricted to Tiltify registered causes with a valid API token.')
                break;

            case 'fundraising-events':
                await respondToInteraction(interaction, 'Restricted to Tiltify registered fundraising-events with a valid API token.')
                break;
        }
    }

    /**
     * Error codes to display in chat.
     * @param interaction
     * @param errorCode
     */
    function error(interaction, errorCode)
    {
        switch (errorCode)
        {
            case 400:
                respondToInteraction(interaction, 'Internal Error `400: Bad Request`')
                break;
            case 401:
                respondToInteraction(interaction, 'Your Tiltify access token is invalid. Please check your access token in the bot\'s config file. `401: Not Authorized`')
                break;
            case 403:
                respondToInteraction(interaction, 'You do not have access to this resource. Please check your access token in the bot\'s config file. `403: Forbidden`')
                break;
            case 404:
                respondToInteraction(interaction, 'Your campaign/team/cause/event was not found. Please check your id. `404: Not Found`')
                break;
            case 422:
                respondToInteraction(interaction, 'Internal Error `422: Unprocessable Entity`')
                break;
            case 0:
                respondToInteraction(interaction, 'Set up the bot first!')
                break;
            default:
                respondToInteraction(interaction, 'There was an error getting to the Tiltify API. Please try again later. `500: Internal Server Error`')
                break;
        }
    }

    /**
     * Start or stop showing donation feeds.
     * @param interaction
     * @param guild
     * @returns {Promise<void>}
     */
    async function startStopDonations(interaction, guild)
    {
        let action = interaction.data.options.find(e => e.name === 'action').value === 'start';

        guild.isActive = action;
        guild.save().then(() => updateStatus());

        if (action)
        {
            await respondToInteraction(interaction, 'Tiltify donations have been **enabled** on this server!');
            return;
        }

        await respondToInteraction(interaction, 'Tiltify donations have been **disabled** on this server.')

    }

    // Add campaign to track. (/add)
    /**
     * Add a new campaign to an existing installation.
     * @param interaction
     * @param guild
     * @returns {Promise<void>}
     */
    async function addCampaign(interaction, guild)
    {
        let campaignData = await fetchData('campaigns', interaction.data.options.find(e => e.name === 'id').value)

        if (campaignData.meta.status === 200)
        {
            if (campaignData.data.status === 'retired')
                await respondToInteraction(interaction, '`' + result.data.name + '` has already ended, please choose an active campaign.');
            else
            {
                let data = await generateData(campaignData.data)
                guild.campaigns.push(data)
                guild.save().then(() => updateStatus());
                await respondToInteraction(interaction, 'Campaign `' + campaignData.data.name + '` has been added.')
            }
        }
        else
            error(interaction, campaignData.meta.status)

    }

    // Remove tracked campaign. (/remove)
    function removeCampaign(interaction, guild)
    {
        if (guild.campaigns.length > 1)
        {
            let campaign = guild.campaigns.find(e => e.tiltifyCampaignId === interaction.data.options.find(e => e.name === 'id').value + '')
            respondToInteraction(interaction, 'Campaign `' + campaign.tiltifyCampaignName + '` has been removed.')
            campaign.isActive = false;
            guild.save().then(() => updateStatus());
            return;
        }
        respondToInteraction(interaction, 'There is only one active campaign, please use `/delete` instead.')
    }

    // Generate embed of all tracked campaigns. (/list)
    async function generateListEmbed(interaction, guild)
    {
        let listEmbed = {
            title: 'Tracked Campaigns',
            url: 'https://tiltify.com',
            fields: [],
            timestamp: new Date(),
        };
        guild.campaigns.forEach(campaign =>
        {
            listEmbed.fields.push({
                name: campaign.tiltifyCampaignName,
                value: `Cause: ${campaign.tiltifyCause}\nTeam: ${campaign.tiltifyTeamName}\nID: ${campaign.tiltifyCampaignId}`,
            })
        })
        await respondToInteractionRaw(interaction, {embeds: [listEmbed]})
    }

    // Change channel where donations are shown. (/channel)
    async function changeChannel(interaction, guild)
    {
        guild.discordChannelId = interaction.data.options.find(e => e.name === 'id').value
        await respondToInteraction(interaction, 'Donations channel has been changed to <#' + interaction.data.options.find(e => e.name === 'id').value + '>')
        guild.save().then(() => updateStatus());
    }

    // Refresh campaign data. (/refresh)
    async function refreshData(interaction, guild)
    {
        for (const c of guild.campaigns)
        {
            let campaignData = await fetchData('campaigns', c.tiltifyCampaignId)
            if (campaignData.data.status === 'retired')
            {
                c.isActive = false;
            }
            if (guild.connectedId !== undefined)
            {
                await updateCampaigns(guild)
            }
        }
        guild.save().then(() => updateStatus());
        await respondToInteraction(interaction, 'Campaigns have been refreshed.');
    }

    // Delete all data. (/delete)
    async function deleteData(interaction, guild)
    {
        await client.guilds.cache.get(interaction.guildID).commands.set([]);
        guild.campaigns = [];
        guild.save().then(() => updateStatus());
        await respondToInteraction(interaction, 'The bot was deactivated. To set up again, please use `/setup`.');
    }

    // Search for active campaigns. (/find)
    async function findCampaigns(interaction, guild)
    {
        let resultId;
        let arg_query = interaction.data.options.find(e => e.name === 'query').value
        let arg_type = interaction.data.options.find(e => e.name === 'type').value
        switch (arg_type)
        {
            case 'users':
                resultId = 'User ID: '
                break;
            case 'teams':
                resultId = 'Team ID: '
                break;
            case 'fundraising-events':
                resultId = 'Event ID: '
                break;
        }

        arg_query = convertToSlug(arg_query)
        let result = await fetchData(arg_type, arg_query)

        if (result.meta.status !== 200)
            await respondToInteraction(interaction, 'Query `' + arg_query + '` could not be found.')
        else
        {
            let name;
            if (arg_type === 'users')
                name = result.data.username;
            else
                name = result.data.name;
            let campaignData = await fetchData(arg_type, result.data.id + '/campaigns?count=100')

            if (campaignData.meta.status !== 200)
                await respondToInteraction(interaction, 'Query `' + arg_query + '` could not be found.')
            else
            {
                let title = titleCase(name)

                let findEmbed = {
                    title: title + '\'s Active Campaigns',
                    description: resultId + result.data.id,
                    url: 'https://tiltify.com',
                    fields: [],
                    timestamp: new Date(),
                };
                campaignData.data.filter(c => c.status !== 'retired').forEach(campaign =>
                {
                    findEmbed.fields.push({
                        name: campaign.name,
                        value: `ID: ${campaign.id}`,
                    })
                })
                if (findEmbed.fields.length > 0)
                    await respondToInteractionRaw(interaction, {embeds: [findEmbed]})
                else
                    await respondToInteraction(interaction, '`' + arg_query + '` does not have any active campaigns.')
            }
        }
    }

// Auto refresh data every 12 hours.
    async function dailyRefresh()
    {
        let allGuilds = Guild.find({})

        for (let g of allGuilds)
        {
            g.campaigns.forEach(c =>
            {
                let result = fetchData('campaigns', c.tiltifyCampaignId)
                if (result.data.status === 'retired' || result.meta.status !== 200)
                    c.isActive = false;
            })
            g.save();
        }

        for (let g of allGuilds)
        {
            if (g.connectedId !== undefined)
                await updateCampaigns(g)

            g.save();
        }
        updateStatus()
    }

    async function updateCampaigns(guild)
    {
        let result = await fetchData(guild.tiltifyType, guild.connectedId + '/campaigns?count=100')

        for (const campaign of result.data)
            if (campaign.status !== 'retired' && !guild.campaigns.includes(item => item.tiltifyCampaignId === campaign.id))
                guild.campaigns.push(await generateData(campaign));
    }

    async function respondToInteractionRaw(interaction, data)
    {
        client.api.interactions(interaction.id, interaction.token).callback.post({
            data: {
                type: 4,
                data: data
            }
        })
    }

    async function respondToInteraction(interaction, content)
    {
        await respondToInteractionRaw(interaction, {content: content})
    }
});

// Login to Discord using token supplied in the config.
client.login(C.DISCORD_TOKEN);