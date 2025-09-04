export interface PoolAlertEmbed {
  title: string;
  description: string;
  color: number;
  fields: Array<{
    name: string;
    value: string;
    inline?: boolean;
  }>;
  timestamp: string;
}

export class DiscordPoolNotifier {
  private readonly webhookUrl: string;

  constructor(webhookUrl: string) {
    this.webhookUrl = webhookUrl;
  }

  // Getter for webhook URL
  getWebhookUrl(): string {
    return this.webhookUrl;
  }

  async sendPoolAlert(embed: PoolAlertEmbed): Promise<void> {
    try {
      const payload = {
        embeds: [embed]
      };

      const response = await fetch(this.webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        throw new Error(`Discord webhook failed: ${response.status} ${response.statusText}`);
      }

      console.log('Pool alert Discord notification sent successfully');
    } catch (error) {
      console.error('Failed to send pool alert Discord notification:', error);
    }
  }

  async sendPoolFoundAlert(poolAddress: string, _tokenMint: string, pool: any): Promise<void> {
    const embed: PoolAlertEmbed = {
      title: 'DAMM Pool Found! 🎉',
      description: 'A new DAMM v2 pool has been created that meets all criteria!',
      color: 0x00ff00, // Green
      fields: [
        {
          name: '🏊‍♂️ Pool Address',
          value: `[${poolAddress}](https://app.meteora.ag/dammv2/${poolAddress})`,
          inline: false
        },
        {
          name: '🪙 Token A',
          value: pool.tokenAMint.toString(),
          inline: true
        },
        {
          name: '🪙 Token B', 
          value: pool.tokenBMint.toString(),
          inline: true
        },
        {
          name: '💰 Fee Schedule',
          value: 'Linear',
          inline: true
        },
        {
          name: '⏰ Detected At',
          value: new Date().toISOString(),
          inline: true
        }
      ],
      timestamp: new Date().toISOString()
    };

    await this.sendPoolAlert(embed);
  }
}
