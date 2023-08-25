/*
 * MIT License
 *
 * Copyright (c) 2023-present Mirage Aegis
 * 
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 * 
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 * 
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

import {
    Activity, ActivityType, Client, Collection, EmbedBuilder, Guild, GuildBan,
    GuildMember, Message, Presence, TextChannel, User
} from "discord.js";
import { leaveIneligibleServer } from "../util/refresh";
import { getAdminLogsChannel } from "../util/channels";
import { Server } from "../schemas/server";
import {
    genMemberBanEmbed, genMemberJoinEmbed, genMemberLeaveEmbed, genMemberUnbanEmbed,
    genMemberUpdateEmbed, genMessageDeleteEmbed, genMessageEditEmbed, genUserUpdateEmbed
} from "./logs";
import { Blacklist } from "../schemas/blacklist";
import { formatGoLivePost } from "./shoutout";

/*
 * This module has event listeners for the bot
 */

/**
 * Logs an embed to a log channel if possible. Does nothing if the
 * server doesn't have logs configured. Deletes configuration if logs isn't a channel.
 * 
 * @param client the Discord bot
 * @param server the server document from the database
 * @param embed the embed to log
 */
const logTo = async (client: Client, server: Server, embed: EmbedBuilder): Promise<void> => {
    const logsID: string = server.logs;

    // Skip if the server isn't subscribed to logs
    if (!logsID) {
        return;
    }

    // Logs is guaranteed to be a logs channel due to the constraints
    // of the /config logs command
    const logs: TextChannel = <TextChannel> client.channels.cache.get(logsID);

    if (!logs) {
        // Remove configurations if the logs do not exist
        server.logs = null;
        await server.save();
    }

    await logs.send({ embeds: [embed] });
};


// ----- USER RELATED -----

/**
 * Logs member join events to servers subscribed to logs.
 * 
 * @param client the Discord bot
 * @param member the member who joined
 */
export const onMemberJoin = async (client: Client, member: GuildMember): Promise<void> => {
    // The server and logs channel ID of the server that the member joined
    const server: Server = await Server.get(member.guild.id);

    await logTo(client, server, genMemberJoinEmbed(member));

    // Check if the new member is blacklisted
    const bl: Blacklist = await Blacklist.get();
    const ban: string = bl.users.get(member.id);

    // Immediately ban if they are
    if (ban) {
        await member.ban({
            reason: ban
        });
    }
};

/**
 * Logs member leave events to servers subscribed to logs.
 * 
 * @param client the Discord bot
 * @param member the member who left
 */
export const onMemberLeave = async (client: Client, member: GuildMember): Promise<void> => {
    // The server and logs channel ID of the server that the member left
    const server: Server = await Server.get(member.guild.id);

    await logTo(client, server, await genMemberLeaveEmbed(member));
};

/**
 * Logs member ban events to servers subscribed to logs.
 * 
 * @param client the Discord bot
 * @param ban the ban data
 */
export const onMemberBan = async (client: Client, ban: GuildBan): Promise<void> => {
    // The server and logs channel ID of the server that the member was banned from
    const server: Server = await Server.get(ban.guild.id);

    await logTo(client, server, await genMemberBanEmbed(ban));
};

/**
 * Logs member unban events to servers subscribed to logs.
 * 
 * @param client the Discord bot
 * @param ban the ban data
 */
export const onMemberUnban = async (client: Client, ban: GuildBan): Promise<void> => {
    // The server and logs channel ID of the server that the member was unbanned from
    const server: Server = await Server.get(ban.guild.id);

    await logTo(client, server, await genMemberUnbanEmbed(ban));
};

/**
 * Logs member server profile update events to servers subscribed to logs.
 * 
 * @param client the Discord bot
 * @param before the member's profile state before update
 * @param after the member's current profile state
 */
export const onMemberUpdate = async (client: Client, before: GuildMember, after: GuildMember): Promise<void> => {
    // The server and logs channel ID of the server that the member updated their profile in
    const server: Server = await Server.get(before.guild.id);
    const embed: EmbedBuilder = genMemberUpdateEmbed(before, after);

    // If embed is null, the changes aren't significant to Sushi Bot
    if (!embed) {
        return;
    }

    await logTo(client, server, embed);
};

/**
 * Logs user profile update events to servers subscribed to logs.
 * 
 * @param client the Discord bot
 * @param before the user's profile state before update
 * @param after the user's current profile state
 */
export const onUserUpdate = async (client: Client, before: User, after: User): Promise<void> => {
    const embed: EmbedBuilder = genUserUpdateEmbed(before, after);

    // If embed is null, the changes aren't significant to Sushi Bot
    if (!embed) {
        return;
    }

    // All mutual servers
    const guilds: Collection<string, Guild> = client.guilds.cache;

    // For each server...
    for await (const [, guild] of guilds) {
        try {
            // If fetched, the user is a member of that server
            await guild.members.fetch(before.id);
        } catch {
            // If not, they're not, so we skip
            continue;
        }

        // The server and logs channel ID of the mutual server
        const server: Server = await Server.get(guild.id);

        embed.setAuthor({
            name: "Profile updated",
            iconURL: guild.iconURL()
        });

        await logTo(client, server, embed);
    }
};

// ----- !USER RELATED -----


// ----- MESSAGE RELATED -----

/**
 * Logs message edit events to servers subscribed to logs.
 * 
 * @param client the Discord bot
 * @param before the message's state before editing
 * @param after the message's current state
 */
export const onMessageEdit = async (client: Client, before: Message, after: Message): Promise<void> => {
    // The server and logs channel ID of the server that had a message edited
    const server: Server = await Server.get(before.guild.id);
    const embed: EmbedBuilder = genMessageEditEmbed(before, after);

    // If embed is null, the changes aren't significant to Sushi Bot
    if (!embed) {
        return;
    }

    await logTo(client, server, embed);
};

/**
 * Logs message delete events to servers subscribed to logs.
 * 
 * @param client the Discord bot
 * @param message the message that was deleted
 */
export const onMessageDelete = async (client: Client, message: Message): Promise<void> => {
    // The server and logs channel ID of the server that had a message deleted
    const server: Server = await Server.get(message.guild.id);
    const embed: EmbedBuilder = genMessageDeleteEmbed(message);

    // If embed is null, the message wasn't significant to Sushi Bot
    if (!embed) {
        return;
    }

    await logTo(client, server, embed);
};

// ----- MESSAGE RELATED -----


// ----- PRESENCE RELATED -----

/**
 * Broadcasts auto go-live posts and auto shout outs to sevrers subscribed to them.
 * 
 * @param client the Discord bot
 * @param before the presence before update
 * @param after the presence after update
 */
export const onPresenceUpdate = async (client: Client, before: Presence, after: Presence): Promise<void> => {
    if (
        !before || !after ||
        before.status === "offline" ||
        after.status === "offline"
    ) {
        return;
    }

    const guild: Guild = after.guild;
    const server: Server = await Server.get(guild.id);
    const member: GuildMember = after.member;
    const oldStreams: Activity[] = [];
    let streams: Activity[] = [];

    // Extract Twitch stream activites
    for (const activity of before.activities) {
        if (
            activity.type === ActivityType.Streaming &&
            activity.name === "Twitch"
        ) {
            oldStreams.push(activity);
            break;
        }
    }

    for (const activity of after.activities) {
        if (
            activity.type === ActivityType.Streaming &&
            activity.name === "Twitch"
        ) {
            streams.push(activity);
            break;
        }
    }

    // Skip if no stream was found
    if (!streams.length) {
        return;
    }
    
    // Check if the stream link has been updated
    if (oldStreams.length) {
        const oldUrls: string[] = oldStreams.map(o => o.url);
        streams = streams.filter(s => !oldUrls.includes(s.url));
    }

    // Auto go-live for server owners
    // Auto shout out for non server owners
    if (member.id === guild.ownerId) {
        // Skip if no auto go-live configured
        if (!server.goLive) {
            return;
        }

        const channel: TextChannel = <TextChannel> client.channels.cache.get(server.goLive.channel);

        for (const stream of streams) {
            try {
                await channel.send(formatGoLivePost(stream, server.goLive.message));
            } catch (e) {
                // Remove auto go-live configuration if we fail to send
                server.goLive = null;
                await server.save();
                throw e;
            }
        }
    } else {
        // Skip if no auto shout out configured
        if (!server.shoutout) {
            return;
        }

        const hasRole: boolean = after.member.roles.cache.get(server.shoutout.role) ? true : false;

        // Skip if the member doesn't have the auto shout out role
        if (!hasRole) {
            return;
        }

        const channel: TextChannel = <TextChannel> client.channels.cache.get(server.shoutout.channel);

        for (const stream of streams) {
            try {
                await channel.send(formatGoLivePost(stream, server.shoutout.message));
            } catch (e) {
                // Remove auto shout out configuration if we fail to send
                server.shoutout = null;
                await server.save();
                throw e;
            }
        }
    }
};

// ----- !PRESENCE RELATED -----


// ----- SERVER RELATED -----

/**
 * Triggered when the bot joins a Discord server.
 * It leaves the server if the owner is ineligible to have the bot.
 * 
 * @param client the Discord bot
 * @param server the Discord server joined
 */
export const onServerJoin = async (client: Client, server: Guild): Promise<void> => {
    const eligible: boolean = await leaveIneligibleServer(client, server, getAdminLogsChannel());

    if (eligible) {
        const bl: Blacklist = await Blacklist.get();

        for await (const [uid, reason] of bl.users) {
            await server.bans.create(
                uid,
                { reason: reason }
            );
        }
    }
};

/**
 * Triggered when the bot leaves a Discord server,
 * or when a Discord server is deleted.
 * It deletes the server configurations from the database.
 * 
 * @param client the Discord bot
 * @param server the Discord server left
 */
export const onServerLeave = async (client: Client, server: Guild): Promise<void> => {
    await (await Server.get(server.id)).delete();
};

// ----- SERVER RELATED -----


/**
 * Triggered when a non-command error occurs.
 * Errors are logged to the admin logs in the admin server.
 * 
 * @param client the Discord bot
 * @param error the error
 */
export const onError = async (client: Client, error: Error): Promise<void> => {
    const logs: TextChannel = getAdminLogsChannel();

    const report: string = "```\n" +
                           "Generic Error\n\n" +
                           `${error}\n\n` +
                           "Details:\n" +
                           `${error.stack}\n` +
                           "```";
    
    await logs.send(report);
};
