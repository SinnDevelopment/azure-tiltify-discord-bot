const fetch = require('node-fetch');
const C = require('./config')
const Discord = require("discord.js");

/**
 * Tiltify API Proxy Method
 * @param {String} type
 * @param {String} id
 */
async function fetchData(type, id)
{
    let req = await fetch(`https://tiltify.com/api/v3/${type}/${id}`, {
        method: 'GET',
        headers: {
            'Authorization': `Bearer ${C.TILTIFY_ACCESS_TOKEN}`
        },
        dataType: 'json',
    })
    return await req.json()
}

/**
 * Generate base data for tiltify campaign based on the model
 * @param campaign
 */
async function generateData(campaign)
{
    let causeData = await fetchData('causes', campaign.causeId)
    let teamID = 0;
    let teamName = 'None';
    if (campaign.team !== undefined && campaign.team !== null)
        teamID = campaign.team.id;

    let result = await fetchData('teams', teamID);
    if (result.meta.status === 200 && result.data.name !== undefined)
        teamName = result.data.name;
    return {
        tiltifyCampaignName: campaign.name,
        tiltifyCampaignId: campaign.id,
        tiltifyCampaignURL: campaign.user.url + '/' + campaign.slug,
        tiltifyCause: causeData.data.name,
        showDonations: true,
        currency: campaign.currency,
        tiltifyTeamName: teamName,
        tiltifyAvatarURL: campaign.avatar.src,
        lastDonationId: 0,
        isActive: true,
    }
}

/**
 * Generates the embed used for campaign tracking updates
 * @param campaign
 * @param donation
 * @returns {module:"discord.js".MessageEmbed}
 */
function generateEmbed(campaign, donation)
{
    let currency = convertCurrency(campaign.currency);
    let donationComment = 'No comment.'
    if (donation.comment !== '')
        donationComment = donation.comment;
    return new Discord.MessageEmbed({
        title: campaign.tiltifyCampaignName + ' received a donation!',
        url: campaign.tiltifyCampaignURL,
        thumbnail: {
            url: campaign.tiltifyAvatarURL,
        },
        fields: [
            {
                name: `${donation.name} donates ${currency}${donation.amount}`,
                value: donationComment,
            }
        ],
        timestamp: new Date(),
        footer: {
            text: 'Donated towards ' + campaign.tiltifyCause,
        }
    });
}

/**
 * Convert a given input to a url slug (users, teams)
 * @param text
 * @returns {string}
 */
function convertToSlug(text)
{
    return text.toLowerCase().replace(/ +/g, '-');
}

/**
 * Convert a string to titlecase
 * @param str
 * @returns {string}
 */
function titleCase(str)
{
    return str.toLowerCase().split(' ').map(function (word)
    {
        return word.replace(word[0], word[0].toUpperCase());
    }).join(' ');
}

/**
 * Get a given currency symbol for a shortcode
 * @param currencyCode
 * @returns {string|*}
 */
function convertCurrency(currencyCode)
{
    const currencySymbols = {
        'USD': '$', // US Dollar
        'EUR': '€', // Euro
        'JPY': '¥', // Japanese Yen
        'GBP': '£', // British Pound Sterling
        'AUD': 'A$', // Australian Dollar
        'CAD': 'C$', // Canadian Dollar
        'CHF': 'CHF', // Swiss Franc
        'CNY': 'CN¥', // Chinese Yuan
        'HKD': 'HK$', // Hong Kong Dollar
        'NZD': 'NZ$', // New Zeland Dollar
        'SER': 'kr', // Swedish Krona
        'KRW': '₩', // South Korean Won
        'SGD': 'S$', // Singapore Dollar
        'NOK': 'kr', // Norwegian Krone
        'MXN': 'MX$', // Mexican Peso
        'INR': '₹', // Indian Rupee
        'RUB': '₽', // Russian Ruble
        'ZAR': 'R', // South African Rand
        'TRY': '₺', // Turkish Iira
        'BRL': 'R$', // Brazilian Real
        'TWD': 'NT$', // New Taiwan Dollar
        'DKK': 'kr', // Danish Krone
        'PLN': 'zł', // Polish Zloty
        'THB': '฿', // Thai Baht
        'IDR': 'Rp', // Indonesian Rupiah
        'HUF': 'Ft', // Hungarian Forint
        'CZK': 'Kč', // Czech Krouna
        'ILS': '₪', // Israeli New Sheqel
        'CLP': 'CLP$', // Chilean Peso
        'PHP': '₱', // Philippine Peso
        'AED': 'د.إ', // UAE Dirham
        'COP': 'COL$', // Colombian Peso
        'SAR': '﷼', // Saudi Riyal
        'MYR': 'RM', //Malaysian Ringgit
        'RON': 'L', // Romanian Leu
        'CRC': '₡', // Costa Rican Colón
        'NGN': '₦', // Nigerian Naira
        'PYG': '₲', // Paraguayan Guarani
        'UAH': '₴', // Ukrainian Hryvnia
        'VND': '₫', // Vietnamese Dong
    };
    if (currencySymbols[currencyCode] !== undefined)
        return currencySymbols[currencyCode];
    else
        return '$';
}

const globalCommandData = [
    {
        name: 'allowinactive',
        description: 'Allow inactive/not-primary campaigns to be added/tracked.',
        options: [
            {
                name: 'enabled',
                type: 'STRING',
                description: 'Allow inactive/not-primary campaigns',
                required: true,
                choices: [
                    {
                        name: 'yes',
                        value: 'true',
                    },
                    {
                        name: 'no',
                        value: 'false',
                    }
                ],
            }
        ]
    },
    {
        name: 'find',
        description: 'Search for active campaigns by user, team or cause',
        options: [{
            name: 'type',
            type: 'STRING',
            description: 'Your type of search',
            required: true,
            choices: [
                {
                    name: 'user',
                    value: 'users',
                },
                {
                    name: 'team',
                    value: 'teams',
                },
                {
                    name: 'cause',
                    value: 'causes',
                }],
        },
            {
                name: 'query',
                type: 'STRING',
                description: 'Your user, team or cause name/id',
                required: true,
            }],
    },
    {
        name: 'setup',
        description: 'Setup the bot with your Tiltify campaign information',
        options: [
            {
                name: 'type',
                type: 'STRING',
                description: 'Your type of campaign',
                required: true,
                choices: [
                    {
                        name: 'campaign',
                        value: 'campaigns',
                    },
                    {
                        name: 'team',
                        value: 'teams',
                    },
                    {
                        name: 'cause',
                        value: 'causes',
                    },
                    {
                        name: 'event',
                        value: 'fundraising-events',
                    },
                ]
            },
            {
                name: 'id',
                type: 'INTEGER',
                description: 'Your Tiltify campaign id',
                required: true,
            }
        ],
    },
    {
        name: 'ping',
        description: 'Test response time to the server',
    },
    {
        name: 'add',
        description: 'Add a campaign to the list of tracked campaigns',
        options: [
            {
                name: 'id',
                type: 'INTEGER',
                description: 'A valid Tiltify campaign id',
                required: true,
            }
        ],
    },
    {
        name: 'remove',
        description: 'Remove a campaign from the list of tracked campaigns',
        options: [{
            name: 'id',
            type: 'INTEGER',
            description: 'A valid Tiltify campaign id',
            required: true,
        }],
    },
    {
        name: 'refresh',
        description: 'Refresh all campaigns attached to a team, cause or event',
    },
    {
        name: 'list',
        description: 'List all tracked campaigns',
    },
    {
        name: 'channel',
        description: 'Change the channel where donations are posted',
        options: [
            {
                name: 'id',
                type: 'CHANNEL',
                description: 'A valid channel in your server',
                required: true,
            }
        ],
    },
    {
        name: 'tiltify',
        description: 'Start or stop the showing of donations',
        options: [
            {
                name: 'action',
                type: 'STRING',
                description: 'Start or stop the showing of donations',
                required: true,
                choices: [
                    {
                        name: 'start',
                        value: 'start',
                    },
                    {
                        name: 'stop',
                        value: 'stop',
                    }
                ],
            }
        ]
    },
    {
        name: 'delete',
        description: 'Deactivate the bot and delete all data',
    }];

module.exports = {
    fetchData,
    generateData,
    generateEmbed,
    convertToSlug,
    titleCase,
    globalCommandData,
}