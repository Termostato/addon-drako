const { StaffActivity, DutyLog } = require('../models/schemas');
const logger = require('../utils/logger');
const { calculatePoints } = require('../utils/pointsSystem');

module.exports.run = async (client) => {
    const voiceStates = new Map();

    client.on('voiceStateUpdate', async (oldState, newState) => {
        if (!oldState.member.roles.cache.has(client.staffConfig.roles.staff)) {
            return;
        }

        if (!oldState.channelId && newState.channelId) {
            voiceStates.set(newState.member.id, Date.now());
        }

        if (oldState.channelId && !newState.channelId) {
            const joinTime = voiceStates.get(oldState.member.id);
            if (!joinTime) {
                return;
            }

            const duration = Math.floor((Date.now() - joinTime) / 60000);

            if (duration < client.staffConfig.points.voice.minimum_session) {
                return;
            }

            let activity = await StaffActivity.findOne({ userId: oldState.member.id });
            if (!activity) {
                activity = new StaffActivity({ userId: oldState.member.id });
            }

            activity.voice_minutes_7d = (activity.voice_minutes_7d || 0) + duration;
            activity.voice_minutes_15d = (activity.voice_minutes_15d || 0) + duration;
            activity.voice_minutes_30d = (activity.voice_minutes_30d || 0) + duration;
            activity.voice_minutes_total = (activity.voice_minutes_total || 0) + duration;
            activity.voice_minutes_per_hour = (activity.voice_minutes_per_hour || 0) + duration;
            activity.last_voice_time = Date.now();

            await activity.save();
            
            await calculatePoints(client, oldState.member.id);
            
            voiceStates.delete(oldState.member.id);
        }
    });

    setInterval(async () => {
        for (const [userId, joinTime] of voiceStates) {
            const member = await client.guilds.cache.first().members.fetch(userId).catch(() => null);
            if (!member || !member.voice.channelId) {
                voiceStates.delete(userId);
                continue;
            }

            const duration = Math.floor((Date.now() - joinTime) / 60000);
            let activity = await StaffActivity.findOne({ userId });
            if (!activity) {
                activity = new StaffActivity({ userId });
            }

            activity.voice_minutes_per_hour = (activity.voice_minutes_per_hour || 0) + 1;
            await activity.save();
        }
    }, 60000);
};
