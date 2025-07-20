const { StaffActivity, ChannelActivity } = require('../models/schemas');
const logger = require('../utils/logger');
const { calculatePoints } = require('../utils/pointsSystem');

module.exports.run = async (client) => {
    client.on('messageCreate', async (message) => {
        if (message.author.bot) return;

        try {
            await StaffActivity.findOneAndUpdate(
                { userId: message.author.id },
                {
                    $inc: {
                        messages_7d: 1,
                        messages_15d: 1,
                        messages_30d: 1,
                        messages_total: 1,
                        messages_per_hour: 1
                    },
                    $set: {
                        last_message_time: Date.now()
                    }
                },
                { 
                    upsert: true,
                    new: true 
                }
            );

            if (message.member?.roles.cache.has(client.staffConfig.roles.staff)) {
                await calculatePoints(client, message.author.id);
            }

            await ChannelActivity.create({
                channelId: message.channel.id,
                userId: message.author.id,
                messageCount: 1,
                timestamp: new Date(),
                hourOfDay: new Date().getHours()
            });

        } catch (error) {
            console.error('Error in message tracker:', error);
        }
    });

    setInterval(async () => {
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

        await ChannelActivity.deleteMany({
            timestamp: { $lt: thirtyDaysAgo }
        });
    }, 60 * 60 * 1000);
};