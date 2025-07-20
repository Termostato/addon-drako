const mongoose = require('mongoose');

const DutyLogSchema = new mongoose.Schema({
    userId: String,
    duty_type: { type: String, enum: ['active', 'invisible'] },
    start_time: Date,
    end_time: Date,
    status: { type: String, enum: ['active', 'completed', 'terminated'] }
});

const StaffActivitySchema = new mongoose.Schema({
    userId: { type: String, unique: true },
    messages_7d: { type: Number, default: 0 },
    messages_15d: { type: Number, default: 0 },
    messages_30d: { type: Number, default: 0 },
    messages_total: { type: Number, default: 0 },
    voice_minutes_7d: { type: Number, default: 0 },
    voice_minutes_15d: { type: Number, default: 0 },
    voice_minutes_30d: { type: Number, default: 0 },
    voice_minutes_total: { type: Number, default: 0 },
    points: { type: Number, default: 0 },
    last_updated: { type: Date, default: Date.now }
});

const VerificationLogSchema = new mongoose.Schema({
    userId: String,
    timestamp: { type: Date, default: Date.now },
    status: { type: String, enum: ['success', 'failed'] },
    duty_session_id: { type: mongoose.Schema.Types.ObjectId, ref: 'DutyLog' }
});

const PanelSchema = new mongoose.Schema({
    channelId: String,
    messageId: String,
    type: { type: String, default: 'duty' }
});

const ChannelActivitySchema = new mongoose.Schema({
    channelId: String,
    userId: String,
    messageCount: Number,
    timestamp: Date,
    hourOfDay: Number
});

module.exports = {
    DutyLog: mongoose.model('DutyLog', DutyLogSchema),
    StaffActivity: mongoose.model('StaffActivity', StaffActivitySchema),
    VerificationLog: mongoose.model('VerificationLog', VerificationLogSchema),
    Panel: mongoose.model('Panel', PanelSchema),
    ChannelActivity: mongoose.model('ChannelActivity', ChannelActivitySchema)
}; 