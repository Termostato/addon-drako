const { SlashCommandBuilder } = require('@discordjs/builders');
const { Panel } = require('../models/schemas');
const { hasPermission } = require('../utils/permissionHelper');
const staffManager = require('../staffManager');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('resetpanel')
        .setDescription('Delete the current duty panel and create a new one'),

    async execute(interaction, client) {
        if (!hasPermission(interaction.member, 'resetpanel', client)) {
            return interaction.reply({
                content: 'You do not have permission to use this command.',
                ephemeral: true
            });
        }

        await interaction.deferReply({ ephemeral: true });

        try {
            const channel = await client.channels.fetch(client.staffConfig.panel.channel_id);
            if (!channel) {
                return interaction.editReply('Panel channel not found!');
            }

            const panel = await Panel.findOne({ type: 'duty' });
            if (panel) {
                try {
                    const oldMessage = await channel.messages.fetch(panel.messageId);
                    if (oldMessage) {
                        await oldMessage.delete();
                    }
                } catch (err) {
                    console.error('Could not delete old panel message:', err);
                }

                await Panel.deleteOne({ type: 'duty' });
            }

            await staffManager.run(client);

            await interaction.editReply('✅ Duty panel has been reset successfully!');
        } catch (error) {
            console.error('Error resetting duty panel:', error);
            await interaction.editReply('❌ An error occurred while resetting the duty panel.');
        }
    }
}; 