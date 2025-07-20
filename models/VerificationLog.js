const { VerificationLog, DutyLog } = require('./schemas');

module.exports = {
    create: async (client, data) => {
        const activeDuty = await DutyLog.findOne({
            userId: data.userId,
            status: 'active'
        }).sort({ start_time: -1 });

        const verificationLog = new VerificationLog({
            userId: data.userId,
            status: data.status,
            timestamp: new Date(),
            duty_session_id: activeDuty?._id
        });

        return await verificationLog.save();
    },

    getStats: async (client, userId, days = 7) => {
        const date = new Date();
        date.setDate(date.getDate() - days);

        const stats = await VerificationLog.aggregate([
            {
                $match: {
                    userId: userId,
                    timestamp: { $gt: date }
                }
            },
            {
                $group: {
                    _id: null,
                    total: { $sum: 1 },
                    successful: {
                        $sum: {
                            $cond: [{ $eq: ['$status', 'success'] }, 1, 0]
                        }
                    }
                }
            }
        ]);

        return stats[0] || { total: 0, successful: 0 };
    }
};