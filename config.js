const {
    DISCORD_BOT_TOKEN,
    DISCORD_PUB_KEY,
    DISCORD_APP_ID,
    TILTIFY_ACCESS_TOKEN,
    DONATION_REFRESH,
    MONGO_URL
} = process.env

module.exports={
    DISCORD_TOKEN: DISCORD_BOT_TOKEN || '',
    DISCORD_PUB_KEY: DISCORD_PUB_KEY || '',
    DISCORD_APP_ID: DISCORD_APP_ID || '',
    TILTIFY_ACCESS_TOKEN: TILTIFY_ACCESS_TOKEN || '',
    DONATION_REFRESH: DONATION_REFRESH || 30000,
    MONGO_URL: MONGO_URL || ''
}