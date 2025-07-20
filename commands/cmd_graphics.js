const { SlashCommandBuilder } = require('@discordjs/builders');
const { EmbedBuilder, AttachmentBuilder } = require('discord.js');
const { generateMetricChart } = require('../utils/chartHelper');
const { getStaffStats } = require('../utils/statsHelper');
const { hasPermission } = require('../utils/permissionHelper');
const { StaffActivity } = require('../models/schemas');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('staffgraphics')
        // Solo traducimos el texto de descripción al español
        .setDescription('Ver gráficos de métricas de staff del servidor')
        .addBooleanOption(option =>
            option.setName('messages')
                .setDescription('Mostrar estadísticas de mensajes')
                .setRequired(false))
        .addBooleanOption(option =>
            option.setName('voice')
                .setDescription('Mostrar estadísticas de actividad de voz')
                .setRequired(false))
        .addBooleanOption(option =>
            option.setName('duty')
                .setDescription('Mostrar estadísticas de horas en servicio')
                .setRequired(false))
        .addBooleanOption(option =>
            option.setName('offduty')
                .setDescription('Mostrar estadísticas de horas fuera de servicio')
                .setRequired(false))
        .addBooleanOption(option =>
            option.setName('points')
                .setDescription('Mostrar estadísticas de puntos')
                .setRequired(false))
        .addStringOption(option =>
            option.setName('period')
                .setDescription('Periodo de tiempo a mostrar')
                .addChoices(
                    { name: '7 Días', value: '7d' },
                    { name: '15 Días', value: '15d' },
                    { name: '30 Días', value: '30d' },
                    { name: 'Todo el tiempo', value: 'all' }
                )
                .setRequired(false)),

    async execute(interaction, client) {
        if (!hasPermission(interaction.member, 'staffgraphics', client)) {
            // Traducción del mensaje de error al español
            return interaction.reply({
                content: 'No tienes permiso para usar este comando.',
                ephemeral: true
            });
        }

        await interaction.deferReply();

        try {
            const period = interaction.options.getString('period') || '7d';
            
            // Get selected metrics
            const selectedMetrics = [];
            if (interaction.options.getBoolean('messages')) selectedMetrics.push('messages');
            if (interaction.options.getBoolean('voice')) selectedMetrics.push('voice');
            if (interaction.options.getBoolean('duty')) selectedMetrics.push('duty');
            if (interaction.options.getBoolean('offduty')) selectedMetrics.push('offduty');
            if (interaction.options.getBoolean('points')) selectedMetrics.push('points');

            // If no metrics selected, show all
            if (selectedMetrics.length === 0) {
                selectedMetrics.push('messages', 'voice', 'duty', 'offduty', 'points');
            }

            const staffMembers = await StaffActivity.find({});
            const stats = await getStaffStats(null, period, true);

            const embed = new EmbedBuilder()
                // Solo traducimos el texto al español
                .setTitle(`📊 Métricas de Staff del Servidor`)
                .setColor('#5865F2')
                .setDescription(`Mostrando estadísticas combinadas de ${staffMembers.length} miembros del staff durante ${stats.totalDays} días`)
                .addFields(
                    { 
                        name: '📝 Mensajes', 
                        value: `Total: ${stats.totals.messages.toLocaleString()}\nProm: ${Math.round(stats.averages.messages).toLocaleString()}/día`, 
                        inline: true 
                    },
                    { 
                        name: '🎤 Horas de Voz', 
                        value: `Total: ${Math.round(stats.totals.voice / 60).toLocaleString()}\nProm: ${Math.round(stats.averages.voice / 60).toLocaleString()}/día`, 
                        inline: true 
                    },
                    { 
                        name: '⚡ Horas en Servicio', 
                        value: `Total: ${Math.round(stats.totals.duty).toLocaleString()}\nProm: ${Math.round(stats.averages.duty).toLocaleString()}/día`, 
                        inline: true 
                    },
                    { 
                        name: '💤 Horas Fuera de Servicio', 
                        value: `Total: ${Math.round(stats.totals.offDuty).toLocaleString()}\nProm: ${Math.round(stats.averages.offDuty).toLocaleString()}/día`, 
                        inline: true 
                    },
                    { 
                        name: '⭐ Puntos', 
                        value: `Total: ${Math.round(stats.totals.points).toLocaleString()}\nProm: ${Math.round(stats.averages.points).toLocaleString()}/día`, 
                        inline: true 
                    }
                )
                .setTimestamp();

            const metricConfigs = {
                messages: {
                    label: 'Mensajes',
                    data: stats.messages,
                    color: client.staffConfig.stats.graph.colors.messages
                },
                voice: {
                    label: 'Horaz de Voz',
                    data: stats.voice.map(v => Math.round((v / 60) * 10) / 10),
                    color: client.staffConfig.stats.graph.colors.voice
                },
                duty: {
                    label: 'Horas en Servicio',
                    data: stats.duty,
                    color: client.staffConfig.stats.graph.colors.duty
                },
                offduty: {
                    label: 'Horas Fuera de Servicio',
                    data: stats.offDuty || stats.labels.map(() => 24),
                    color: client.staffConfig.stats.graph.colors.inactive || '#F04747'
                },
                points: {
                    label: 'Puntos',
                    data: stats.points,
                    color: '#FFD700'
                }
            };

            const chartData = {
                labels: stats.labels,
                datasets: selectedMetrics.map(metric => ({
                    label: metricConfigs[metric].label,
                    data: metricConfigs[metric].data,
                    borderColor: metricConfigs[metric].color,
                    backgroundColor: `${metricConfigs[metric].color}15`
                }))
            };

            const chartBuffer = await generateMetricChart(chartData, 'all', period);
            const attachment = new AttachmentBuilder(chartBuffer, { name: 'staff_metrics.png' });
            embed.setImage('attachment://staff_metrics.png');
            await interaction.editReply({ embeds: [embed], files: [attachment] });

        } catch (error) {
            console.error('Error in staffgraphics command:', error);
            // Traducción del mensaje de error al español
            await interaction.editReply('Ocurrió un error al generar los gráficos.');
        }
    }
};