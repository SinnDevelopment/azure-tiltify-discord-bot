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

const http = require('http');

//create a server object:
http.createServer(function (req, res)
{
    res.write("Go away. There's nothing here for you");
    res.end();
}).listen(8080);

console.debug("CONFIG: " + JSON.stringify(C));

const client = new Discord.Client({intents: ['GUILDS', 'GUILD_MESSAGES', 'GUILD_INTEGRATIONS']});
const discordInteractions = new DiscordInteractions({
    applicationId: C.DISCORD_APP_ID,
    authToken: C.DISCORD_TOKEN,
    publicKey: C.DISCORD_PUB_KEY
})
const Guild = mongoose.model('Guild', M.DISCORD_GUILD);
const Campaign = mongoose.model('Campaign', M.TILTIFY_CAMPAIGN)
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
    await dailyRefresh();

    // Check donations every n seconds (defined in config).
    setInterval(function ()
    {
        refreshDonations()
    }, C.DONATION_REFRESH)

    // Auto refresh data every 12 hours.
    setInterval(function ()
    {
        dailyRefresh()
    }, 60 * 60 * 1000 * 12);

    // Check and route a command.
    client.ws.on('INTERACTION_CREATE', async interaction =>
    {
        console.debug("Interaction received: " + JSON.stringify(interaction));

        let isSetup = await Guild.exists({discordGuildId: interaction.guild_id});
        const guild = await Guild.findOne({discordGuildId: interaction.guild_id}).exec();

        if (managePermission(interaction))
        {
            switch (interaction.data.name)
            {
                case 'ping':
                    pingPong(interaction, guild);
                    break;
                case 'setup':
                    await setupTiltify(interaction, guild);
                    break;
                case 'tiltify':
                    isSetup ? await startStopDonations(interaction, guild) : await error(interaction, 0);
                    break;
                case 'add':
                    isSetup ? await addCampaign(interaction, guild) : await error(interaction, 0);
                    break;
                case 'remove':
                    isSetup ? await removeCampaign(interaction, guild) : await error(interaction, 0);
                    break;
                case 'list':
                    isSetup ? await generateListEmbed(interaction, guild) : await error(interaction, 0);
                    break;
                case 'channel':
                    isSetup ? await changeChannel(interaction, guild) : await error(interaction, 0);
                    break;
                case 'refresh':
                    isSetup ? await refreshData(interaction, guild) : await error(interaction, 0);
                    break;
                case 'delete':
                    isSetup ? await deleteData(interaction, guild) : await error(interaction, 0);
                    break;
                case 'find':
                    isSetup ? await findCampaigns(interaction, guild) : await error(interaction, 0);
                    break;
                case 'allowinactive':
                    isSetup ? await allowInactiveCampaigns(interaction, guild) : await error(interaction, -1);
            }
        }
        else
            await error(interaction,-2)
    });
});


/**
 *
 * @param {module:"discord.js".Interaction} interaction
 * @returns {boolean}
 */
function managePermission(interaction)
{
    let guild = client.guilds.cache.get(interaction.guild_id)
    let member = guild.members.cache.get(interaction.member.user.id)
    return member.permissions.has(Discord.Permissions.FLAGS.MANAGE_CHANNELS)
}


/**
 * Update the status message in Discord.
 */
function updateStatus(numCampaigns, guilds)
{
    client.user.setPresence({status: "online"});
    client.user.setActivity(numCampaigns + ' campaigns on ' + guilds + ' servers', {type: "WATCHING"});
}

/**
 *
 * @param {module:"discord.js".Interaction} interaction
 * @param guild
 * @returns {Promise<void>}
 */
async function allowInactiveCampaigns(interaction, guild)
{
    guild.allowNonActiveCampaigns = interaction.data.options.find(e => e.name === 'enabled').value
    await guild.save()
    if (guild.allowNonActiveCampaigns)
        await respondToInteraction(interaction, 'Inactive campaigns have been **enabled** on this server!');
    else
        await respondToInteraction(interaction, 'Inactive campaigns have been **disabled** on this server!');
}

function refreshDonations()
{
    Guild.find({isActive: true}).then(async function (allGuilds)
    {
        for (const guild of allGuilds)
        {
            for (const campaign of guild.campaigns.filter(c => c.isActive))
            {
                console.debug("Checking for: " + campaign.tiltifyCampaignName, Date.now());

                let donation = await fetchData('campaigns', `${campaign.tiltifyCampaignId}/donations`)
                try
                {
                    if (campaign.lastDonationId === 'undefined' || donation.data.length === 0)
                        continue;
                    if (campaign.lastDonationId !== Number(donation.data[0].id))
                    {
                        let embed = generateEmbed(campaign, donation.data[0])
                        const channel = client.channels.cache.find(c => c.id === guild.discordChannelId)
                        channel.send({
                            embeds: [embed]
                        });
                        campaign.lastDonationId = donation.data[0].id;
                        guild.save()
                    }
                }
                catch (exception)
                {
                    console.log('There was an error reading donation data on ' + Date.now());
                    console.log(exception)
                }
            }
        }
    })
}


//
/**
 * Check bot ping time
 * @param interaction
 */
async function pingPong(interaction)
{
    await respondToInteraction(interaction, '`' + (Date.now() - interaction.createdTimestamp) + '` ms');
}

/**
 * Initial setup for the discord guild.
 * @param interaction
 * @param guild
 */
async function setupTiltify(interaction, guild)
{

    if (await Guild.exists({discordGuildId: interaction.guild_id}))
    {
        await respondToInteraction(interaction, 'This server is already in the database, please use `/add` to add a campaign or `/delete` .')
        return;
    }

    guild = new Guild({discordGuildId: interaction.guild_id});

    let type_param = interaction.data.options.find(e => e.name === 'type')
    let id_param = interaction.data.options.find(e => e.name === 'id')


    let result = await fetchData(type_param.value, id_param.value)

    if (result.meta.status !== 200)
    {
        await error(interaction, result.meta.status)
        return;
    }
    let number = 0;

    guild.discordGuildId = interaction.guild_id;
    guild.discordChannelId = interaction.channel_id;
    guild.campaigns = [];
    guild.isActive = false;
    guild.tiltifyType = type_param.value
    guild.allowNonActiveCampaigns = false;

    switch (type_param.value)
    {
        case 'campaigns':
            if (result.data.status === 'retired')
            {
                await respondToInteraction(interaction, '`' + result.data.name + '` has already ended, please choose an active campaign.');
                return;
            }
            guild.campaigns.push(generateData(result.data));
            await guild.save()
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
                for (const teamCampaign of teamData.data)
                {
                    if (teamCampaign.status !== 'retired' && !guild.allowNonActiveCampaigns)
                    {
                        let tc_id = teamCampaign.id
                        if (teamCampaign.amountRaised !== 0)
                        {
                            let c = await fetchData('campaigns', tc_id)
                            guild.campaigns.push(await generateData(c.data));
                        }
                        let supportingCampaigns = await fetchData('campaigns', `${tc_id}/supporting-campaigns`)
                        for (const suppCampaign of supportingCampaigns.data)
                        {
                            number++;
                            let c = await fetchData('campaigns', suppCampaign.id)
                            guild.campaigns.push(await generateData(c.data));
                        }

                    }
                }
                guild.connectedId = id_param.value;
                await guild.save()
                await respondToInteraction(interaction, 'Donations have been setup for team `' + result.data.name + '`, ' + number + ' active campaigns were found.')
                return;
            }
            await error(interaction, result.meta.status)
            break;
        case 'causes':
            await respondToInteraction(interaction, 'Restricted to Tiltify registered causes with a valid API token.')
            break;
        case 'fundraising-events':
            await respondToInteraction(interaction, 'Restricted to Tiltify registered fundraising-events with a valid API token.')
            break;
        default:
            break;
    }
}

/**
 * Error codes to display in chat.
 * @param interaction
 * @param {Number} errorCode
 */
async function error(interaction, errorCode)
{
    switch (errorCode)
    {
        case 400:
            await respondToInteraction(interaction, 'Internal Error `400: Bad Request`')
            break;
        case 401:
            await respondToInteraction(interaction, 'Your Tiltify access token is invalid. Please check your access token in the bot\'s config file. `401: Not Authorized`')
            break;
        case 403:
            await respondToInteraction(interaction, 'You do not have access to this resource. Please check your access token in the bot\'s config file. `403: Forbidden`')
            break;
        case 404:
            await respondToInteraction(interaction, 'Your campaign/team/cause/event was not found. Please check your id. `404: Not Found`')
            break;
        case 422:
            await respondToInteraction(interaction, 'Internal Error `422: Unprocessable Entity`')
            break;
        case 0:
            await respondToInteraction(interaction, 'Set up the bot first!')
            break;
        case -1:
            await respondToInteraction(interaction, 'You don\'t have permission to do this!')
            break;
        case -2:
            await respondToInteraction(interaction, 'You do not have the MANAGE_CHANNELS permission.')
            break;
        default:
            await respondToInteraction(interaction, 'There was an error getting to the Tiltify API. Please try again later. `500: Internal Server Error`')
            break;
    }
}

/**
 * Start or stop showing donation feeds.
 * @param interaction
 * @param guild
 */
async function startStopDonations(interaction, guild)
{
    let action = interaction.data.options.find(e => e.name === 'action').value === 'start';

    guild.isActive = action;
    guild.save()

    if (action)
    {
        await respondToInteraction(interaction, 'Tiltify donations have been **enabled** on this server!');
        return;
    }

    await respondToInteraction(interaction, 'Tiltify donations have been **disabled** on this server.')

}

/**
 * Add a new campaign to an existing installation.
 * @param interaction
 * @param guild
 */
async function addCampaign(interaction, guild)
{
    let id = interaction.data.options.find(e => e.name === 'id').value
    if (guild.campaigns.find(c => c.tiltifyCampaignId === id) != null)
    {
        await respondToInteraction(interaction, 'This campaign has already been added.')
        return;
    }
    let campaignData = await fetchData('campaigns', id)

    if (campaignData.meta.status === 200)
    {
        if (campaignData.data.status === 'retired' && !guild.allowNonActiveCampaigns)
            await respondToInteraction(interaction, '`' + campaignData.data.name + '` has already ended, please choose an active campaign.');
        else
        {
            let data = await generateData(campaignData.data)
            guild.campaigns.push(data)
            guild.save()
            await respondToInteraction(interaction, 'Campaign `' + campaignData.data.name + '` has been added.')
        }
    }
    else
        await error(interaction, campaignData.meta.status)
}

/**
 * Remove a tracked campaign
 * @param interaction
 * @param guild
 */
async function removeCampaign(interaction, guild)
{
    if (guild.campaigns.length > 1)
    {
        let campaign = guild.campaigns.find(e => e.tiltifyCampaignId === interaction.data.options.find(e => e.name === 'id').value + '')
        await respondToInteraction(interaction, 'Campaign `' + campaign.tiltifyCampaignName + '` has been removed.')
        campaign.isActive = false;
        await guild.save()
        return;
    }
    await respondToInteraction(interaction, 'There is only one active campaign, please use `/delete` instead.')
}

/**
 *
 * @param interaction
 * @param guild
 * @returns {Promise<void>}
 */
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

/**
 *
 * @param interaction
 * @param guild
 * @returns {Promise<void>}
 */
async function changeChannel(interaction, guild)
{
    guild.discordChannelId = interaction.data.options.find(e => e.name === 'id').value
    await respondToInteraction(interaction, 'Donations channel has been changed to <#' + interaction.data.options.find(e => e.name === 'id').value + '>')
    await guild.save()
}

// Refresh campaign data. (/refresh)
/**
 *
 * @param interaction
 * @param guild
 * @returns {Promise<void>}
 */
async function refreshData(interaction, guild)
{
    for (const c of guild.campaigns)
    {
        let campaignData = await fetchData('campaigns', c.tiltifyCampaignId)
        if (campaignData.data.status === 'retired' && !guild.allowNonActiveCampaigns)
        {
            c.isActive = false;
        }
        if (guild.connectedId !== undefined)
        {
            await updateCampaigns(guild)
        }
    }
    guild.save()
    await respondToInteraction(interaction, 'Campaigns have been refreshed.');
}

// Delete all data. (/delete)
/**
 *
 * @param interaction
 * @param guild
 * @returns {Promise<void>}
 */
async function deleteData(interaction, guild)
{
    await Guild.deleteOne(guild, function (err)
    {
        if (err !== null)
        {

            console.error("Error deleting guild from mongo.", JSON.stringify(guild))
            console.error(err)
        }
    });
    await respondToInteraction(interaction, 'All campaigns have been removed; Please use /setup again.');
}


/**
 * Get a target campaign/team's id.
 * @param interaction
 * @param guild
 * @returns {Promise<void>}
 */
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

/**
 * Refresh all campaigns in all servers
 * @returns {Promise<void>}
 */
async function dailyRefresh()
{
    let cursor = Guild.find().cursor();
    let numCampaigns = 0;
    let numGuilds = 0;
    for (let guild = await cursor.next(); guild != null; guild = await cursor.next())
    {
        numGuilds++;
        for (const c of guild.campaigns)
        {
            let result = await fetchData('campaigns', c.tiltifyCampaignId)
            console.debug(c.tiltifyCampaignName + ":" + result.data.status)
            if ((result.data.status === 'retired' && !guild.allowNonActiveCampaigns) || result.meta.status !== 200)
                c.isActive = false;
            else
                numCampaigns++;
        }
        if (guild.connectedId !== undefined)
            await updateCampaigns(guild)
        await guild.save();
    }
    console.log("Daily count: " + numCampaigns, "Daily Guilds: " + numGuilds)
    updateStatus(numCampaigns, numGuilds)
}

/**
 * Update campaigns for a given server
 * @param guild
 * @returns {Promise<void>}
 */
async function updateCampaigns(guild)
{
    let result = await fetchData(guild.tiltifyType, guild.connectedId + '/campaigns?count=100')
    for (const campaign of result.data)
    {
        if (campaign.status !== 'retired'
            && guild.campaigns.filter(item => item.tiltifyCampaignId === '' + campaign.id).length === 0)
        {
            console.log("Adding missing campaign: " + campaign.id, campaign.tiltifyCampaignName)
            guild.campaigns.push(await generateData(campaign));
        }

    }
}

/**
 * Respond to an interaction with the raw json data
 * @param {module:"discord.js".Interaction} interaction
 * @param data
 */
function respondToInteractionRaw(interaction, data)
{
    client.api.interactions(interaction.id, interaction.token).callback.post({
        data: {
            type: 4,
            data: data
        }
    })
}

/**
 * Respond to an interaction with a clean message.
 * @param {module:"discord.js".Interaction} interaction
 * @param content
 * @returns {Promise<void>}
 */
async function respondToInteraction(interaction, content)
{
    respondToInteractionRaw(interaction, {content: content})
}

client.login(C.DISCORD_TOKEN);