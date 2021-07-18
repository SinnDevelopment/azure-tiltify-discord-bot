const mongoose = require('mongoose');
const TILTIFY_CAMPAIGN = new mongoose.Schema({
    tiltifyCampaignName: String,
    tiltifyCampaignId: String,
    tiltifyAuthToken: String,
    tiltifyCampaignURL: String,
    tiltifyCause: String,
    showDonations: Boolean,
    currency: String,
    tiltifyTeamName: String,
    tiltifyAvatarURL: String,
    lastDonationId: Number,
    isActive: Boolean,
}), DISCORD_GUILD = new mongoose.Schema({
    discordGuildName: String,
    discordGuildId: String,
    discordChannelId: String,
    campaigns: [TILTIFY_CAMPAIGN],
    isActive: Boolean,
    tiltifyType: String,
    connectedId: String,
});
export default {DISCORD_GUILD: DISCORD_GUILD};