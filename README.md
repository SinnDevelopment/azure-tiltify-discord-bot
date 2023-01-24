# azure-tiltify-discord-bot
A bot designed to be deployed to the cloud (Azure now) (or another cloud with slight modification) that posts updates to discord based on a Tiltify campaign.

This is designed to use mongo for a database instead of local flatfiles to allow for cloud deployment/containerization.

## Hosted Version
This version of the bot is to be deployed for a wider setup (ie, for a team) instead of for an individual installation.
The reason for this is that the hosted version (parent of this fork) is not "secure" in the sense that all keys are 
plaintext available to the host. The non-hosted version uses flatfile data storage, which isn't scalable, nor is it safe
local server failures.

## Requirements
On top of the original system requirements, this version requires using the following:
- MongoDB
- Docker

Though not required, it's strongly recommended to use the following to deploy the app:
- Azure ACI

If needed, AWS DocumentDB can be replaced with a self-hosted mongodb instance.


## Installation
Requirements:
- Mongo DB URI
- Discord Bot Token
- Discord Integration/App Id
- Discord Integration Public Key
- Tiltify API Access Token

Set the relevant environment variables as specified in `config.js`.

## Usage
To get started, run the `/setup` command, select your type, and enter an id. If successful, the bot will find an active 
campaign to track. Finally, run `/tiltify action:start` to start the donation stream.

To find active campaigns, run `/find`, select your type and enter a search query. If found, the bot will list all active
campaigns and their id's.

## Commands
This bot uses slash commands, they can be found by typing `/` in Discord and clicking the bot icon. Locked commands are 
only accessible once the bot has been setup with `/setup`.

#### General Commands
- `/find <type> <query>`: Search for active campaigns by user, team, or cause
- `/ping`: Test the bot's response time to the server (Not currently implemented)
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
