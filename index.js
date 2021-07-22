const Discord = require('discord.js');
const mongoose = require('mongoose');
const {DiscordInteractions} = require("slash-commands");

const M = require('./model');
const C = require('./config');

const {
    fetchData,
    generateData,
    generateEmbed,
    listEmbedGenerator,
    convertToSlug,
    titleCase,
    globalCommandData,
    guildCommandData
} = require('./utils');


console.log("CONFIG: ");
console.log(C);

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
        console.log("Found " + found.length + " documents");
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
    }
    else
    {
        console.log("Commands have been installed already");
        console.debug(commandList)
    }

    console.log('Global command check complete, the bot is now online.');
    updateStatus();
    dailyRefresh();

    // Check donations every n seconds (defined in config).
    setInterval(function ()
    {
        //console.debug("Checking for donations...")
        Guild.find({isActive: true}).then(function (allGuilds)
        {
            allGuilds.forEach(guild =>
            {
                console.debug("Checking for: " + guild.tiltifyCampaignName);
                guild.campaigns.filter(c => c.isActive).forEach(campaign =>
                {

                    let donation = fetchData('campaigns', `${campaign.tiltifyCampaignId}/donations`)
                    try
                    {
                        if (campaign.lastDonationId !== donation.data[0].id)
                        {
                            let embed = generateEmbed(campaign, donation.data[0])
                            client.channels.cache.get(guild.discordChannelId).send({embeds: [callback]})
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
        console.log("Interaction received");
        console.log(interaction);
        let isSetup = await Guild.exists({discordGuildId: interaction.guild_id});
        let guild = await Guild.find({discordGuildId: interaction.guild_id}).exec();
        console.log("guild: " + guild)
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
                await createGuildCommands(interaction);
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

                    await createGuildCommands(interaction);
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
        let action = interaction.options.get('action').value === 'start';

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
        let campaignData = await fetchData('campaigns', interaction.options.get('id').value)

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
            let campaign = guild.campaigns.find({tiltifyCampaignId: interaction.options.get('id').value}).exec();
            respondToInteraction(interaction, 'Campaign `' + campaign.name + '` has been removed.')
            campaign.isActive = false;
            guild.save().then(() => updateStatus());
            return;
        }
        respondToInteraction(interaction, 'There is only one active campaign, please use `/delete` instead.')
    }

    // Generate embed of all tracked campaigns. (/list)
    async function generateListEmbed(interaction, guild)
    {
        await respondToInteractionRaw(interaction, {embeds: [await listEmbedGenerator(guild)]})
    }

    // Change channel where donations are shown. (/channel)
    async function changeChannel(interaction, guild)
    {
        guild.discordChannelId = interaction.options.get('id').value;
        await respondToInteraction(interaction, 'Donations channel has been changed to <#' + interaction.options.get('id').value + '>')
        guild.save().then(() => updateStatus());
    }

    // Refresh campaign data. (/refresh)
    async function refreshData(interaction, guild)
    {
        for (const c of guild.campaigns)
        {
            let campaignData = await fetchData('campaigns', c)
            if (campaignData.data.status === 'retired')
            {
                c.isActive = false;

            }
            if (guild.connectedId !== undefined)
            {
                updateCampaigns(guild)
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
        switch (interaction.options.get('type').value)
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
        let query = convertToSlug(interaction.options.get('query').value)
        let result = await fetchData(interaction.options.get('type').value, query)

        if (result.meta.status !== 200)
            await respondToInteraction(interaction, 'Query `' + interaction.options.get('query').value + '` could not be found.')
        else
        {
            let name;
            if (interaction.options.get('type').value === 'users')
                name = result.data.username;
            else
                name = result.data.name;
            let campaignData = fetchData(interaction.options.get('type').value, result.data.id + '/campaigns?count=100')

            if (campaignData.meta.status !== 200)
                await respondToInteraction(interaction, 'Query `' + interaction.options.get('query').value + '` could not be found.')
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
                campaignData.data.forEach(campaign =>
                {
                    if (campaign.status !== 'retired')
                    {
                        findEmbed.fields.push({
                            name: campaign.name,
                            value: `ID: ${campaign.id}`,
                        })
                    }
                })
                if (findEmbed.fields.length > 0)
                    await respondToInteractionRaw(interaction, {embeds: [findEmbed]})
                else
                    await respondToInteraction(interaction, '`' + interaction.options.get('query').value + '` does not have any active campaigns.')
            }
        }
    }

// Auto refresh data every 12 hours.
    async function dailyRefresh()
    {
        let allGuilds = Guild.find({})

        for (let i = 0; i < allGuilds.size(); i++)
        {
            const g = allGuilds[i];
            g.campaigns.forEach(c =>
            {
                let result = fetchData('campaigns', c.tiltifyCampaignId)
                if (result.data.status === 'retired' || result.meta.status !== 200)
                    c.isActive = false;
            })
            g.save();
        }

        for (let i = 0; i < allGuilds.length; i++)
        {
            const g = allGuilds[i];
            if (g.connectedId !== undefined)
                updateCampaigns(g)

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

// Create guild slash commands.
    async function createGuildCommands(interaction)
    {
        for (const c of guildCommandData)
        {
            await discordInteractions.createApplicationCommand(c, interaction.guild_id);
        }
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