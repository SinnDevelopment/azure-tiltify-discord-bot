const Discord = require('discord.js');
const mongoose = require('mongoose');

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

const client = new Discord.Client({intents: ['GUILDS', 'GUILD_MESSAGES']});


const Guild = mongoose.model('Guild', M.DISCORD_GUILD);

mongoose.connect(C.MONGO_URL, {useNewUrlParser: true, useUnifiedTopology: true});

const db = mongoose.connection;

db.on('open', function ()
{
    console.log("Connected to mongo.");
})


client.once('ready', async () =>
{
    // Check for global commands.
    const commandList = await client.api.applications(client.user.id).commands.get();
    if (commandList === undefined || commandList.length === 0)
        await client.application?.commands.set(globalCommandData);
    console.log('Global command check complete, the bot is now online.');
    updateStatus();
    dailyRefresh();

    // Check donations every n seconds (defined in config).
    setInterval(function ()
    {
        Guild.find({}).then(function (allGuilds)
        {
            allGuilds.filter(g => g.isActive).forEach(guild =>
            {
                guild.campaigns.filter(c => c.isActive).forEach(campaign =>
                {
                    let donation;
                    fetchData('campaigns', `${campaign.tiltifyCampaignId}/donations`, (callback) =>
                    {
                        donation = callback;
                        try
                        {
                            if (campaign.lastDonationId !== donation.data[0].id)
                            {
                                generateEmbed(campaign, donation.data[0],
                                    (callback) => client.channels.cache
                                        .get(guild.discordChannelId)
                                        .send({embeds: [callback]}));
                                campaign.lastDonationId = donation.data[0].id;
                                guild.save().then(() => updateStatus());
                            }
                        }
                        catch
                        {
                            console.log('There was an error reading donation data on ' + Date.toString());
                        }
                    });
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
    client.on('interactionCreate', async interaction =>
    {
        await interaction.defer();
        const botID = await interaction.guild.members.fetch(client.user.id);
        if (interaction.channel.permissionsFor(botID).has("MANAGE_MESSAGES"))
        {
            let isSetup = Guild.exists({discordGuildId: interaction.guildID});
            let guild = Guild.findOne({discordGuildId: interaction.guildID}).exec();
            switch (interaction.commandName)
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
                    isSetup ? generateListEmbed(interaction, guild) : error(interaction, 0);
                    break;
                case 'channel':
                    isSetup ? changeChannel(interaction, guild) : error(interaction, 0);
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
        }
        else
            await interaction.editReply({content: 'You do not have permission to use this command.', ephemeral: true});
    });

    /**
     * Update the status message in Discord.
     */
    function updateStatus()
    {
        let numCampaigns = 0;
        Guild.find({}).then(function (guilds)
        {
            guilds.forEach(g => numCampaigns += g.campaigns.countDocuments());
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
        interaction.editReply('`' + (Date.now() - interaction.createdTimestamp) + '` ms');
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
        if (await Guild.exists({discordGuildId: interaction.guildID}))
        {
            interaction.editReply('This server is already in the database, please use `/add` to add a campaign or `/delete` .')
            return;
        }

        guild = new Guild({discordGuildId: interaction.guildID});

        fetchData(interaction.options.get('type').value, interaction.options.get('id').value, async (result) =>
        {
            if (result.meta.status !== 200)
            {
                error(interaction, result.meta.status)
                return;
            }
            let number = 0;

            guild.discordGuildId = interaction.guildID;
            guild.discordChannelId = interaction.channelID;
            guild.campaigns = [];
            guild.isActive = false;
            guild.tiltifyType = interaction.options.get('type').value;

            switch (interaction.options.get('type').value)
            {
                case 'campaigns':
                    if (result.data.status === 'retired')
                    {
                        interaction.editReply('`' + result.data.name + '` has already ended, please choose an active campaign.');
                        return;
                    }
                    generateData(result.data, (callback) =>
                    {
                        guild.campaigns.push(callback);
                        guild.save().then(() => updateStatus());
                        createGuildCommands(interaction);
                        interaction.editReply('Donations have been setup for campaign `' + result.data.name + '`.')
                    })
                    break;
                case 'teams':
                    if (result.data.disbanded)
                    {
                        await interaction.editReply('`' + result.data.name + '` has been disbanded, please choose an active team.');
                        return;
                    }
                    fetchData('teams', interaction.options.get('id').value + '/campaigns?count=100',
                        async (teamData) =>
                        {
                            if (teamData.meta.status === 200)
                            {
                                teamData.data.forEach(campaign =>
                                {
                                    if (campaign.status !== 'retired')
                                    {
                                        number++;
                                        generateData(campaign, (callback) =>
                                        {
                                            guild.campaigns.push(callback);
                                        });
                                    }
                                })
                                guild.connectedId = interaction.options.get('id').value;
                                guild.save().then(() => updateStatus());
                                await createGuildCommands(interaction);
                                await interaction.editReply('Donations have been setup for team `' + result.data.name + '`, ' + number + ' active campaigns were found.')
                                return;
                            }
                            error(interaction, result.meta.status)
                        });
                    break;
                case 'causes':
                    await interaction.editReply('Restricted to Tiltify registered causes with a valid API token.')
                    break;

                // let causeData;
                // fetchData('causes', interaction.options.get('id').value + '/campaigns?count=100', (callback) => causeData = callback);
                // if (causeData.meta.status === 200) {
                // 	causeData.data.forEach(campaign => {
                // 		if (campaign.status !== 'retired') {
                // 			number++;
                // 			generateData(campaign, (callback) => dataToWrite.campaigns.push(callback))
                // 		}
                // 	})
                // dataToWrite.push({ connectedId: interaction.options.get('id').value })
                // 	await guildData.push(dataToWrite);
                // 	writeData();
                // 	createGuildCommands(interaction);
                // 	interaction.editReply('Donations have been setup for cause `' + result.data.name + '`, ' + number + ' active campaigns were found.')
                // 	break;
                // }
                // error(interaction, data.meta.status)
                // break;

                case 'fundraising-events':
                    await interaction.editReply('Restricted to Tiltify registered fundraising-events with a valid API token.')
                    break;

                // let eventData;
                // fetchData('fundraising-events', interaction.options.get('id').value + '/campaigns?count=100', (callback) => eventData = callback);
                // if (eventData.meta.status === 200) {
                // 	eventData.data.forEach(campaign => {
                // 		if (campaign.status !== 'retired') {
                // 			number++;
                // 			generateData(campaign, (callback) => dataToWrite.campaigns.push(callback))
                // 		}
                // 	})
                // dataToWrite.push({ connectedId: interaction.options.get('id').value })
                // 	await guildData.push(dataToWrite);
                // 	writeData();
                // 	createGuildCommands(interaction);
                // 	interaction.editReply('Donations have been setup for event `' + result.data.name + '`, ' + number + ' active campaigns were found.')
                // 	break;
                // }
                // error(interaction, data.meta.status)
                // break;
            }
        });
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
                interaction.editReply('Internal Error `400: Bad Request`')
                break;
            case 401:
                interaction.editReply('Your Tiltify access token is invalid. Please check your access token in the bot\'s config file. `401: Not Authorized`')
                break;
            case 403:
                interaction.editReply('You do not have access to this resource. Please check your access token in the bot\'s config file. `403: Forbidden`')
                break;
            case 404:
                interaction.editReply('Your campaign/team/cause/event was not found. Please check your id. `404: Not Found`')
                break;
            case 422:
                interaction.editReply('Internal Error `422: Unprocessable Entity`')
                break;
            case 0:
                interaction.editReply('Set up the bot first!')
                break;
            default:
                interaction.editReply('There was an error getting to the Tiltify API. Please try again later. `500: Internal Server Error`')
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
            await interaction.editReply('Tiltify donations have been **enabled** on this server!');
            return;
        }

        await interaction.editReply('Tiltify donations have been **disabled** on this server.')

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
        fetchData('campaigns', interaction.options.get('id').value, (campaignData) =>
        {
            if (campaignData.meta.status === 200)
            {
                if (campaignData.data.status === 'retired')
                    interaction.editReply('`' + result.data.name + '` has already ended, please choose an active campaign.');
                else
                {
                    generateData(campaignData.data, (data) =>
                    {
                        guild.campaigns.push(data)
                        guild.save().then(() => updateStatus());
                        interaction.editReply('Campaign `' + campaignData.data.name + '` has been added.')
                    });
                }
            }
            else
                error(interaction, campaignData.meta.status)
        });
    }

    // Remove tracked campaign. (/remove)
    function removeCampaign(interaction, guild)
    {
        if (guild.campaigns.length > 1)
        {
            let campaign = guild.campaigns.find({tiltifyCampaignId: interaction.options.get('id').value}).exec();
            interaction.editReply('Campaign `' + campaign.name + '` has been removed.')
            campaign.isActive = false;
            guild.save().then(() => updateStatus());
            return;
        }
        interaction.editReply('There is only one active campaign, please use `/delete` instead.')
    }

    // Generate embed of all tracked campaigns. (/list)
    function generateListEmbed(interaction, guild)
    {
        listEmbedGenerator(guild, (callback) => interaction.editReply({embeds: [callback]}))
    }

    // Change channel where donations are shown. (/channel)
    function changeChannel(interaction, guild)
    {
        guild.discordChannelId = interaction.options.get('id').value;
        interaction.editReply('Donations channel has been changed to <#' + interaction.options.get('id').value + '>')
        guild.save().then(() => updateStatus());
    }

    // Refresh campaign data. (/refresh)
    async function refreshData(interaction, guild)
    {
        guild.campaigns.forEach(c =>
        {
            fetchData('campaigns', guild.campaigns[j].id, (campaignData) =>
            {
                if (campaignData.data.status === 'retired')
                {
                    c.isActive = false;
                    guild.save().then(() => updateStatus());
                }
                if (guild.connectedId !== undefined)
                {
                    fetchData(guild.type, guild.connectedId + '/campaigns?count=100', (result) =>
                    {
                        result.data.forEach(campaign =>
                        {
                            if (campaign.status !== 'retired' && !guild.campaigns.includes(item => item.id === campaign.id))
                            {
                                generateData(campaign, (callback) =>
                                {
                                    guild.campaigns.push(callback)
                                    guild.save().then(() => updateStatus());
                                });
                            }
                        })
                    })
                }
            });
        });

        await interaction.editReply('Campaigns have been refreshed.');

    }

    // Delete all data. (/delete)
    async function deleteData(interaction, guild)
    {
        await client.guilds.cache.get(interaction.guildID).commands.set([]);
        guild.campaigns = [];
        guild.save().then(() => updateStatus());
        await interaction.editReply('The bot was deactivated. To set up again, please use `/setup`.');
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
        convertToSlug(interaction.options.get('query').value, (query) =>
        {
            fetchData(interaction.options.get('type').value, query, (result) =>
            {
                if (result.meta.status !== 200)
                    interaction.editReply('Query `' + interaction.options.get('query').value + '` could not be found.')
                else
                {
                    let name;
                    if (interaction.options.get('type').value === 'users')
                        name = result.data.username;
                    else
                        name = result.data.name;
                    fetchData(interaction.options.get('type').value, result.data.id + '/campaigns?count=100', (campaignData) =>
                    {
                        if (campaignData.meta.status !== 200)
                            interaction.editReply('Query `' + interaction.options.get('query').value + '` could not be found.')
                        else
                        {
                            titleCase(name, (title) =>
                            {
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
                                    interaction.editReply({embeds: [findEmbed]})
                                else
                                    interaction.editReply('`' + interaction.options.get('query').value + '` does not have any active campaigns.')

                            });
                        }
                    });
                }
            });
        });
    }

    // Auto refresh data every 12 hours.
    function dailyRefresh()
    {
        Guild.find({}).then(function (allGuilds)
        {

            allGuilds.forEach(g => g.campaigns.forEach(c =>
            {
                fetchData('campaigns', c.tiltifyCampaignId, (result) =>
                {
                    if (result.data.status === 'retired' || result.meta.status !== 200)
                        c.isActive = false;
                })
                g.save();
            }));

            allGuilds.forEach(g =>
            {
                if (g.connectedId !== undefined)
                {
                    fetchData(allGuilds[i].tiltifyType, g.connectedId + '/campaigns?count=100', (result) =>
                    {
                        result.data.forEach(campaign =>
                        {
                            if (campaign.status !== 'retired' && !allGuilds[i].campaigns.includes(item => item.tiltifyCampaignId === campaign.id))
                                generateData(campaign, (callback) =>
                                {
                                    g.campaigns.push(callback);
                                    g.save().then(() => updateStatus());
                                })
                        })
                    });
                }
            });
        })
    }

    // Create guild slash commands.
    async function createGuildCommands(interaction)
    {
        await client.guilds.cache.get(interaction.guildID).commands.set(guildCommandData);
    }
});

// Login to Discord using token supplied in the config.
client.login(C.DISCORD_TOKEN);