const { StaffActivity, DutyLog, VerificationLog } = require('../models/schemas');

module.exports = {
    calculatePoints: async (client, userId) => {
        const activity = await StaffActivity.findOne({ userId: userId });
        if (!activity) return 0;

        const activeDuty = await DutyLog.findOne({
            userId: userId,
            status: 'active',
            duty_type: 'active'
        });

        if (!activeDuty) {
            activity.points = 0;
            await activity.save();
            return 0;
        }

        const config = client.staffConfig.points;
        let totalPoints = 0;

        const baseMessagePoints = (activity.messages_7d || 0) * config.messages.per_message;
        totalPoints += baseMessagePoints;
        let messageBonus = 0;

        if (activity.messages_7d > config.messages.bonus_threshold) {
            const bonusMessages = activity.messages_7d - config.messages.bonus_threshold;
            messageBonus = bonusMessages * config.messages.bonus_amount;
            totalPoints += messageBonus;
        }

        const voicePoints = (activity.voice_minutes_7d || 0) * config.voice.per_minute;
        if (voicePoints > 0) {
            totalPoints += voicePoints;
        }

        const weekAgo = new Date();
        weekAgo.setDate(weekAgo.getDate() - 7);

        const verificationLogs = await VerificationLog.find({
            userId: userId,
            timestamp: { $gte: weekAgo }
        });

        let verificationPoints = 0;
        verificationLogs.forEach(log => {
            verificationPoints += log.status === 'success' ? 
                config.verification.success : 
                config.verification.failure;
        });
        
        if (verificationPoints !== 0) {
            totalPoints += verificationPoints;
        }

        totalPoints = Math.max(0, Math.floor(totalPoints));

        await StaffActivity.findOneAndUpdate(
            { userId: userId },
            { $set: { points: totalPoints } },
            { new: true }
        );

        return totalPoints;
    },

    calculateInactiveHours: async (userId, startDate) => {
        const dutyLogs = await DutyLog.find({
            userId: userId,
            start_time: { $gte: startDate },
            status: { $in: ['completed', 'terminated'] }
        });

        let totalDutyTime = 0;
        for (const log of dutyLogs) {
            if (log.end_time) {
                totalDutyTime += (log.end_time - log.start_time) / (1000 * 60 * 60);
            }
        }

        const totalPossibleHours = (new Date() - startDate) / (1000 * 60 * 60);
        
        return Math.max(0, totalPossibleHours - totalDutyTime);
    }
};
