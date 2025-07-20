const { SlashCommandBuilder } = require('@discordjs/builders');
const { DutyLog, StaffActivity } = require('../models/schemas');
const logger = require('../utils/logger');
const { hasPermission } = require('../utils/permissionHelper');

module.exports = {
    data: new SlashCommandBuilder()
        // Solo traducimos el texto de descripción al español
        .setName('staffadmin')
        .setDescription('Comandos de administración para gestionar el staff')
        .addSubcommand(subcommand =>
            subcommand
                .setName('duty')
                // Traducimos la descripción al español
                .setDescription('Forzar cambio de estado de servicio')
                .addUserOption(option =>
                    option.setName('user')
                        // Traducimos la descripción
                        .setDescription('Usuario a modificar')
                        .setRequired(true)
                )
                .addStringOption(option =>
                    option.setName('action')
                        // Traducimos la descripción
                        .setDescription('Acción a realizar')
                        .setRequired(true)
                        .addChoices(
                            // Traducimos las opciones
                            { name: 'Forzar Servicio Activo', value: 'active' },
                            { name: 'Forzar Servicio Invisible', value: 'invisible' },
                            { name: 'Forzar Fuera de Servicio', value: 'off' }
                        )
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('points')
                // Traducimos la descripción
                .setDescription('Modificar puntos del staff')
                .addUserOption(option =>
                    option.setName('user')
                        // Traducimos la descripción
                        .setDescription('Usuario a modificar')
                        .setRequired(true)
                )
                .addIntegerOption(option =>
                    option.setName('amount')
                        // Traducimos la descripción
                        .setDescription('Cantidad a agregar/eliminar (usar negativo para restar)')
                        .setRequired(true)
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('activity')
                // Traducimos la descripción
                .setDescription('Modificar actividad del staff')
                .addUserOption(option =>
                    option.setName('user')
                        // Traducimos la descripción
                        .setDescription('Usuario a modificar')
                        .setRequired(true)
                )
                .addStringOption(option =>
                    option.setName('type')
                        // Traducimos la descripción
                        .setDescription('Tipo de actividad')
                        .setRequired(true)
                        .addChoices(
                            { name: 'Mensajes', value: 'messages' },
                            { name: 'Minutos de Voz', value: 'voice' },
                            { name: 'Horas de Servicio', value: 'duty' }
                        )
                )
                .addIntegerOption(option =>
                    option.setName('amount')
                        // Traducimos la descripción
                        .setDescription('Cantidad a agregar/eliminar (usar negativo para restar)')
                        .setRequired(true)
                )
        ),

    async execute(interaction, client) {
        if (!hasPermission(interaction.member, 'staffadmin', client)) {
            // Traducimos el mensaje de error
            return interaction.reply({
                content: 'No tienes permiso para usar este comando.',
                ephemeral: true
            });
        }

        const subcommand = interaction.options.getSubcommand();
        const targetUser = interaction.options.getUser('user');

        switch (subcommand) {
            case 'duty':
                await handleDutyChange(interaction, client, targetUser);
                break;
            case 'points':
                await handlePointsModification(interaction, client, targetUser);
                break;
            case 'activity':
                await handleActivityModification(interaction, client, targetUser);
                break;
        }
    }
};

async function handleDutyChange(interaction, client, targetUser) {
    const action = interaction.options.getString('action');
    
    if (action === 'off') {
        const activeDuty = await DutyLog.findOne({
            userId: targetUser.id,
            status: 'active'
        });

        if (activeDuty) {
            activeDuty.status = 'terminated';
            activeDuty.end_time = new Date();
            await activeDuty.save();

            if (client.verificationManager) {
                client.verificationManager.clearVerification(targetUser.id);
            }

            await logger.dutyLeave(
                client,
                targetUser.id, 
                Math.floor((activeDuty.end_time - activeDuty.start_time) / 60000),
                activeDuty.duty_type,
                'admin_terminated'
            );
        }
    } else {
        await DutyLog.findOneAndUpdate(
            { userId: targetUser.id, status: 'active' },
            { status: 'terminated', end_time: new Date() }
        );

        const dutyLog = new DutyLog({
            userId: targetUser.id,
            duty_type: action,
            start_time: new Date(),
            status: 'active'
        });
        await dutyLog.save();

        if (client.verificationManager) {
            client.verificationManager.startVerificationSystem(targetUser.id, action);
        }

        await logger.dutyEnter(client, targetUser.id, action);
    }

    await client.staffManager.updateDutyPanel();
    // Traducimos la respuesta
    await interaction.reply({
        content: `Se cambió correctamente el estado de servicio de ${targetUser.tag} a ${action}.`,
        ephemeral: true
    });
}

async function handlePointsModification(interaction, client, targetUser) {
    const amount = interaction.options.getInteger('amount');
    
    let activity = await StaffActivity.findOne({ userId: targetUser.id });
    if (!activity) {
        activity = new StaffActivity({ userId: targetUser.id });
    }

    activity.points = Math.max(0, (activity.points || 0) + amount);
    await activity.save();

    // Traducimos la respuesta
    await interaction.reply({
        content: `Se modificaron los puntos de ${targetUser.tag} en ${amount}. Nuevo total: ${activity.points}`,
        ephemeral: true
    });
}

async function handleActivityModification(interaction, client, targetUser) {
    const type = interaction.options.getString('type');
    const amount = interaction.options.getInteger('amount');

    let activity = await StaffActivity.findOne({ userId: targetUser.id });
    if (!activity) {
        activity = new StaffActivity({ userId: targetUser.id });
    }

    switch (type) {
        case 'messages':
            activity.messages_7d = Math.max(0, (activity.messages_7d || 0) + amount);
            activity.messages_15d = Math.max(0, (activity.messages_15d || 0) + amount);
            activity.messages_30d = Math.max(0, (activity.messages_30d || 0) + amount);
            break;
        case 'voice':
            activity.voice_minutes_7d = Math.max(0, (activity.voice_minutes_7d || 0) + amount);
            activity.voice_minutes_15d = Math.max(0, (activity.voice_minutes_15d || 0) + amount);
            activity.voice_minutes_30d = Math.max(0, (activity.voice_minutes_30d || 0) + amount);
            break;
        case 'duty':
            if (amount > 0) {
                const dutyLog = new DutyLog({
                    userId: targetUser.id,
                    duty_type: 'active',
                    start_time: new Date(Date.now() - (amount * 60 * 60 * 1000)),
                    end_time: new Date(),
                    status: 'completed'
                });
                await dutyLog.save();
            }
            break;
    }

    await activity.save();
    // Traducimos la respuesta
    await interaction.reply({
        content: `Se modificó la actividad de ${targetUser.tag} en ${type} por ${amount}.`,
        ephemeral: true
    });
}