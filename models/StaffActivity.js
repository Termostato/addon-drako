const { StaffActivity } = require('./schemas');

module.exports = {
    findOrCreate: async (client, userId) => {
        let activity = await StaffActivity.findOne({ userId: userId });

        if (!activity) {
            activity = new StaffActivity({ userId: userId });
            await activity.save();
        }

        return activity;
    },

    updateActivity: async (client, userId, type, amount) => {
        const update = {};
        const fields = type === 'message' ? 
            ['messages_7d', 'messages_15d', 'messages_30d', 'messages_total'] :
            ['voice_minutes_7d', 'voice_minutes_15d', 'voice_minutes_30d', 'voice_minutes_total'];

        fields.forEach(field => {
            update[field] = amount;
        });

        await StaffActivity.findOneAndUpdate(
            { userId: userId },
            { 
                $inc: update,
                last_updated: new Date()
            },
            { upsert: true }
        );
    }
};