const { SlashCommandBuilder } = require('@discordjs/builders');
const { EmbedBuilder } = require('discord.js');
const { StaffActivity, ChannelActivity } = require('../models/schemas');
const { hasPermission } = require('../utils/permissionHelper');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('activity')
        .setDescription('Ver el top de actividad del servidor')
        .addSubcommand(subcommand =>
            subcommand
                .setName('top')
                .setDescription('Ver los rankings')
                .addStringOption(option =>
                    option.setName('period')
                        .setDescription('Periodo por analizar')
                        .setRequired(true)
                        .addChoices(
                            { name: '7 Días', value: '7d' },
                            { name: '15 Días', value: '15d' },
                            { name: '30 Días', value: '30d' },
                            { name: 'Siempre', value: 'all' }
                        ))),

    async execute(interaction, client) {
        if (!hasPermission(interaction.member, 'activity', client)) {
            return interaction.reply({
                content: 'No tienes permiso para usar este comando.',
                ephemeral: true
            });
        }

        await interaction.deferReply();

        try {
            const period = interaction.options.getString('period');

            const topUsers = await getTopUsers(period, client);
            const topChannels = await getTopChannels(period, client);

            const embed = new EmbedBuilder()
                .setTitle('🏆 Rankings de Actividad del Servidor')
                .setColor(client.staffConfig.panel.embed.color)
                .setDescription(`Actividad top para ${getPeriodLabel(period)}`);

            if (topUsers.length > 0) {
                const userList = await Promise.all(topUsers.map(async (user, index) => {
                    return `${index + 1}. <@${user.userId}> - **${user.total}** mensajes\n` +
                           `└ Prom: **${Math.round(user.avgPerDay)}**/día, **${Math.round(user.avgPerHour)}**/hora`;
                }));

                embed.addFields({
                    name: '👥 Usuarios Más Activos',
                    value: userList.join('\n\n'),
                    inline: false
                });
            }

            if (topChannels.length > 0) {
                const channelList = topChannels.map((channel, index) =>
                    `${index + 1}. <#${channel.channelId}> - **${channel.total}** mensajes\n` +
                    `└ Prom: **${Math.round(channel.avgPerDay)}**/día, **${Math.round(channel.avgPerHour)}**/hora`
                ).join('\n\n');

                embed.addFields({
                    name: '📊 Canales Más Activos',
                    value: channelList,
                    inline: false
                });
            }

            embed.setTimestamp();
            await interaction.editReply({ embeds: [embed] });
        } catch (error) {
            console.error('Error in activity top command:', error);
            await interaction.editReply('Ocurrió un error al obtener los rankings de actividad.');
        }
    }
};

async function getTopUsers(period, client) {
    const startDate = getStartDate(period);

    const pipeline = [
        {
            $match: {
                timestamp: { $gte: startDate }
            }
        },
        {
            $group: {
                _id: '$userId',
                total: { $sum: '$messageCount' },
                hourCounts: { $push: '$hourOfDay' }
            }
        },
        {
            $sort: { total: -1 }
        },
        {
            $limit: 5
        }
    ];

    const results = await ChannelActivity.aggregate(pipeline);
    const days = getDayCount(period);

    return results.map(user => ({
        userId: user._id,
        total: user.total,
        avgPerDay: user.total / days,
        avgPerHour: user.total / (days * 24)
    }));
}

async function getTopChannels(period, client) {
    const startDate = getStartDate(period);

    const pipeline = [
        {
            $match: {
                timestamp: { $gte: startDate }
            }
        },
        {
            $group: {
                _id: '$channelId',
                total: { $sum: '$messageCount' },
                hourCounts: { $push: '$hourOfDay' }
            }
        },
        {
            $sort: { total: -1 }
        },
        {
            $limit: 5
        }
    ];

    const results = await ChannelActivity.aggregate(pipeline);
    const days = getDayCount(period);

    return results.map(channel => ({
        channelId: channel._id,
        total: channel.total,
        avgPerDay: channel.total / days,
        avgPerHour: channel.total / (days * 24)
    }));
}

function getStartDate(period) {
    const date = new Date();
    switch (period) {
        case '7d':
            date.setDate(date.getDate() - 7);
            break;
        case '15d':
            date.setDate(date.getDate() - 15);
            break;
        case '30d':
            date.setDate(date.getDate() - 30);
            break;
        case 'all':
            date.setFullYear(2000);
            break;
    }
    return date;
}

function getDayCount(period) {
    switch (period) {
        case '7d': return 7;
        case '15d': return 15;
        case '30d': return 30;
        case 'all': return 30;
        default: return 7;
    }
}

function getPeriodLabel(period) {
    const labels = {
        '7d': 'Últimos 7 Días',
        '15d': 'Últimos 15 Días',
        '30d': 'Últimos 30 Días',
        'all': 'Todo el tiempo'
    };
    return labels[period] || period;
}
