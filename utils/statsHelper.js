const { DutyLog, StaffActivity, ChannelActivity } = require('../models/schemas');
const moment = require('moment');
const { Chart } = require('chart.js');
const { createCanvas } = require('canvas');

async function getPeriodStartDate(period) {
    const date = new Date();
    if (period === 'all') {
        const earliest = await StaffActivity.findOne({}, {}, { sort: { 'last_updated': 1 } });
        return earliest ? earliest.last_updated : new Date();
    }

    switch (period) {
        case '4d':
            date.setDate(date.getDate() - 4);
            break;
        case '7d':
            date.setDate(date.getDate() - 7);
            break;
        case '15d':
            date.setDate(date.getDate() - 15);
            break;
        case '30d':
            date.setDate(date.getDate() - 30);
            break;
        default:
            date.setDate(date.getDate() - 7);
    }
    return date;
}

function getDayCount(period) {
    switch (period) {
        case '24h': return 1;
        case '3d': return 3;
        case '7d': return 7;
        case '15d': return 15;
        case '30d': return 30;
        case 'all': return 30;
        default: return 7;
    }
}

async function getStaffStats(userId, period, includeGraphData = false) {
    const startDate = await getPeriodStartDate(period);
    const days = getDayCount(period);

    const messageStats = await ChannelActivity.aggregate([
        {
            $match: {
                userId: userId,
                timestamp: { $gte: startDate }
            }
        },
        {
            $group: {
                _id: {
                    year: { $year: "$timestamp" },
                    month: { $month: "$timestamp" },
                    day: { $dayOfMonth: "$timestamp" }
                },
                dailyMessages: { $sum: "$messageCount" }
            }
        },
        {
            $sort: { "_id.year": 1, "_id.month": 1, "_id.day": 1 }
        }
    ]);

    const dutyStats = await DutyLog.aggregate([
        {
            $match: {
                userId: userId,
                start_time: { $gte: startDate },
                end_time: { $exists: true }
            }
        },
        {
            $project: {
                date: { $dateToString: { format: "%Y-%m-%d", date: "$start_time" } },
                duration: {
                    $divide: [
                        { $subtract: ["$end_time", "$start_time"] },
                        3600000
                    ]
                }
            }
        },
        {
            $group: {
                _id: "$date",
                dailyDutyHours: { $sum: "$duration" }
            }
        },
        {
            $sort: { "_id": 1 }
        }
    ]);

    const voiceStats = await StaffActivity.aggregate([
        {
            $match: {
                userId: userId,
                last_updated: { $gte: startDate }
            }
        },
        {
            $group: {
                _id: {
                    $dateToString: { format: "%Y-%m-%d", date: "$last_updated" }
                },
                totalVoiceMinutes: { $sum: "$voice_minutes_30d" }
            }
        },
        {
            $sort: { "_id": 1 }
        }
    ]);

    const currentVoiceSession = await StaffActivity.findOne(
        { userId: userId, voice_channel_id: { $exists: true, $ne: null } },
        { voice_join_timestamp: 1 }
    );

    const dailyData = {
        messages: new Array(days).fill(0),
        voice: new Array(days).fill(0),
        duty: new Array(days).fill(0),
        offDuty: new Array(days).fill(24)
    };

    const getDateIndex = (dateStr) => {
        const date = new Date(dateStr);
        const today = new Date();
        today.setHours(23, 59, 59, 999);
        const diffTime = today.getTime() - date.getTime();
        const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
        return days - diffDays - 1;
    };

    messageStats.forEach(day => {
        const dateStr = `${day._id.year}-${String(day._id.month).padStart(2, '0')}-${String(day._id.day).padStart(2, '0')}`;
        const dayIndex = getDateIndex(dateStr);
        if (dayIndex >= 0 && dayIndex < days) {
            dailyData.messages[dayIndex] = day.dailyMessages;
        }
    });

    dutyStats.forEach(day => {
        const dayIndex = getDateIndex(day._id);
        if (dayIndex >= 0 && dayIndex < days) {
            const dutyHours = Math.min(24, Math.round(day.dailyDutyHours));
            dailyData.duty[dayIndex] = dutyHours;
            dailyData.offDuty[dayIndex] = Math.max(0, 24 - dutyHours);
        }
    });

    voiceStats.forEach(day => {
        const dayIndex = getDateIndex(day._id);
        if (dayIndex >= 0 && dayIndex < days) {
            dailyData.voice[dayIndex] = Math.round((day.totalVoiceMinutes || 0) / 60);
        }
    });

    if (currentVoiceSession?.voice_join_timestamp) {
        const currentSessionMinutes = Math.floor(
            (Date.now() - currentVoiceSession.voice_join_timestamp) / (1000 * 60)
        );
        const todayIndex = days - 1;
        dailyData.voice[todayIndex] += Math.round(currentSessionMinutes / 60);
    }

    const totalMessages = dailyData.messages.reduce((sum, val) => sum + val, 0);
    const totalVoiceHours = dailyData.voice.reduce((sum, val) => sum + val, 0);
    const totalDutyHours = dailyData.duty.reduce((sum, val) => sum + val, 0);
    const totalOffDutyHours = dailyData.offDuty.reduce((sum, val) => sum + val, 0);

    const smoothData = (data) => {
        return data.map((val, i, arr) => {
            if (i === 0 || i === arr.length - 1) return val;
            return Math.round((arr[i - 1] + val + arr[i + 1]) / 3);
        });
    };

    const stats = {
        totals: {
            messages: totalMessages,
            voice: totalVoiceHours,
            duty: totalDutyHours,
            offDuty: totalOffDutyHours
        },
        averages: {
            messages: Math.round(totalMessages / days),
            voice: Math.round(totalVoiceHours / days),
            duty: Math.round(totalDutyHours / days),
            offDuty: Math.round(totalOffDutyHours / days)
        },
        daily: {
            messages: smoothData(dailyData.messages),
            voice: smoothData(dailyData.voice),
            duty: smoothData(dailyData.duty),
            offDuty: smoothData(dailyData.offDuty)
        }
    };

    return stats;
}

function getDayIndex(dateId, totalDays) {
    const date = new Date(dateId.year, dateId.month - 1, dateId.day);
    const today = new Date();
    const diffDays = Math.floor((today - date) / (1000 * 60 * 60 * 24));
    return totalDays - diffDays - 1;
}

function getPeriodLabel(period) {
    const labels = {
        '7d': 'Last 7 Days',
        '15d': 'Last 15 Days',
        '30d': 'Last 30 Days',
        'all': 'All Time'
    };
    return labels[period] || period;
}

module.exports = {
    generateActivityGraph: async (client, datasets, period) => {
        const width = 1200;
        const height = 800;
        const canvas = createCanvas(width, height);
        const ctx = canvas.getContext('2d');

        const configuration = {
            type: 'line',
            data: {
                labels: datasets[0].labels,
                datasets: datasets.map(dataset => ({
                    label: dataset.label,
                    data: dataset.data,
                    borderColor: dataset.borderColor,
                    backgroundColor: `${dataset.borderColor}15`,
                    fill: true,
                    tension: 0.4
                }))
            },
            options: {
                responsive: false,
                scales: {
                    y: {
                        beginAtZero: true,
                        grid: {
                            color: '#ffffff22'
                        },
                        ticks: {
                            color: '#ffffff'
                        }
                    },
                    x: {
                        grid: {
                            color: '#ffffff22'
                        },
                        ticks: {
                            color: '#ffffff'
                        }
                    }
                },
                plugins: {
                    legend: {
                        labels: {
                            color: '#ffffff'
                        }
                    }
                }
            }
        };

        const chart = new Chart(ctx, configuration);
        const buffer = canvas.toBuffer('image/png');
        chart.destroy();
        
        return buffer;
    },
    getStaffStats,
    getPeriodStartDate,
    getPeriodLabel,
    getDayCount
};