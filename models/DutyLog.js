const { DutyLog } = require('./schemas');

module.exports = {
    create: async (client, data) => {
        const dutyLog = new DutyLog({
            userId: data.userId,
            duty_type: data.duty_type,
            start_time: new Date(),
            status: data.status
        });
        return await dutyLog.save();
    },

    update: async (client, id, data) => {
        const result = await DutyLog.findByIdAndUpdate(id, data, { new: true });
        return !!result;
    },

    findActive: async (client, userId) => {
        return await DutyLog.findOne({
            userId: userId,
            status: 'active'
        });
    },

    endSession: async (client, userId) => {
        return await DutyLog.findOneAndUpdate(
            { userId: userId, status: 'active' },
            { 
                end_time: new Date(),
                status: 'completed'
            }
        );
    }
};