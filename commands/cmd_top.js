const { SlashCommandBuilder } = require('@discordjs/builders');
const { EmbedBuilder } = require('discord.js');
const { StaffActivity, DutyLog } = require('../models/schemas');
const { hasPermission } = require('../utils/permissionHelper');

module.exports = {
    data: new SlashCommandBuilder()
        // Solo traducimos el texto de descripción al español (ya está en español)
        .setName('stafftop')
        .setDescription('Ver el top de las estadisticas del staff')
        .addStringOption(option =>
            option.setName('category')
                .setDescription('Categoria a observar')
                .setRequired(true)
                .addChoices(
                    { name: 'Puntos', value: 'points' },
                    { name: 'Mensajes', value: 'messages' },
                    { name: 'Voz', value: 'voice' },
                    { name: 'Horas de Trabajo', value: 'duty' }
                )
        ),

    async execute(interaction, client) {
        if (!hasPermission(interaction.member, 'stafftop', client)) {
            // Mensaje de error en español
            return interaction.reply({
                content: 'No tienes permiso para ejecutar este comando.',
                ephemeral: true
            });
        }

        const category = interaction.options.getString('category');
        await interaction.deferReply();

        let topStaff;
        let title = '';
        let format = '';

        const weekAgo = new Date();
        weekAgo.setDate(weekAgo.getDate() - 7);

        switch (category) {
            case 'points':
                topStaff = await StaffActivity.find({})
                    .sort({ points: -1 })
                    .limit(10);
                title = '🏆 Top Staff - Puntos';
                format = 'pts';
                break;

            case 'messages':
                topStaff = await StaffActivity.find({})
                    .sort({ messages_7d: -1 })
                    .limit(10);
                title = '💬 Top Staff - Mensajes';
                format = 'msgs';
                break;

            case 'voice':
                topStaff = await StaffActivity.find({})
                    .sort({ voice_minutes_7d: -1 })
                    .limit(10);
                title = '🎤 Top Staff - Tiempo en Voice';
                format = 'hrs';
                break;

            case 'duty':
                topStaff = await DutyLog.aggregate([
                    {
                        $match: {
                            start_time: { $gte: weekAgo },
                            status: { $in: ['completed', 'terminated'] }
                        }
                    },
                    {
                        $group: {
                            _id: '$userId',
                            totalHours: {
                                $sum: {
                                    $divide: [
                                        {
                                            $subtract: ['$end_time', '$start_time']
                                        },
                                        3600000
                                    ]
                                }
                            }
                        }
                    },
                    {
                        $sort: { totalHours: -1 }
                    },
                    {
                        $limit: 10
                    }
                ]);
                title = '⏰ Top Staff - Horas de Trabajo';
                format = 'hrs';
                break;
        }

        const embed = new EmbedBuilder()
            .setTitle(title)
            .setColor(client.staffConfig.panel.embed.color)
            .setDescription(
                await Promise.all(
                    topStaff.map(async (staff, index) => {
                        let value;
                        if (category === 'voice') {
                            value = Math.round((staff.voice_minutes_7d / 60) * 10) / 10;
                        } else if (category === 'duty') {
                            value = Math.round(staff.totalHours * 10) / 10;
                            // Para la opción 'duty', staff._id corresponde al userId
                            return `${index + 1}. <@${staff._id}> - **${value}** ${format}`;
                        } else {
                            value = category === 'points' ? staff.points : staff.messages_7d;
                        }
                        return `${index + 1}. <@${staff.userId || staff._id}> - **${value}** ${format}`;
                    })
                ).then(lines => lines.join('\n'))
            )
            .setFooter({ text: 'Las estadisticas se basan en los ultimos 7 dias' })
            .setTimestamp();

        await interaction.editReply({ embeds: [embed] });
    }
};