# aws-tiltify-discord-bot
A bot designed to be deployed to AWS (or another cloud with slight modification) that posts updates to discord based on a Tiltify campaign.

This is designed to use mongo for a database instead of local flatfiles to allow for cloud deployment/containerization.

## Hosted Version
This version of the bot is to be deployed for a wider setup (ie, for a team) instead of for an individual installation.
The reason for this is that the hosted version (parent of this fork) is not "secure" in the sense that all keys are 
plaintext available to the host.

## Requirements
The user configuring the bot must have the "manage messages" or admin permission on the server to invite the bot. The bot
will only work if it has the "manage messages" permission in the channel where the command will be run, otherwise the 
command won't work. It's recommended that you create an announcement channel that the bot and trusted users can access 
to prevent unauthorized users from adding/removing campaigns, starting/stopping donations, etc...

## Installation
You will need a Discord bot token, and a Tiltify API access token, obtaining the two are outside the scope of this guide.
Download the latest [release](https://github.com/nicnacnic/tiltify-donation-bot/releases),
and unzip the files to a folder of your choice. In `config.json`, copy/paste your bot token and access token into the
first two fields. Finally, run `node index.js` whenever you want to start the bot. *Note that it can take up to an hour
for the slash commands to appear on first startup.*

## Usage
To get started, run the `/setup` command, select your type, and enter an id. If successful, the bot will find an active 
campaign to track. Finally, run `/tiltify start` to start the donation stream.

To find active campaigns, run `/find`, select your type and enter a search query. If found, the bot will list all active
campaigns and their id's.

## Commands
This bot uses slash commands, they can be found by typing `/` in Discord and clicking the bot icon. Locked commands are 
only accessible once the bot has been setup with `/setup`.

#### General Commands
- `/find <type> <query>`: Search for active campaigns by user, team, or cause
- `/ping`: Test the bot's response time to the server
- `/setup <type> <id>`: Setup the bot with your Tiltify campaign information

#### Locked Commands
- `/add <id>`: Add a campaign to the list of tracked campaigns
- `/channel <id>`: Change the channel where donations are posted
- `/delete`: Deactivate the bot and delete all data
- `/list`: List all tracked campaigns
- `/refresh`: Refresh all campaigns attatched to a team, cause or event
- `/remove <id>`: Remove a campaign for the list of tracked campaigns
- `/tiltify <action>`: Start or stop the showing of donations

## Support
Contact support@sinndevelopment.com for more information.
