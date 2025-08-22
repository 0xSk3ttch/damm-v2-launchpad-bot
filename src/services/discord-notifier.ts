export interface DiscordWebhookPayload {
    content?: string;
    embeds?: Array<{
        title?: string;
        description?: string;
        color?: number;
        fields?: Array<{
            name: string;
            value: string;
            inline?: boolean;
        }>;
        timestamp?: string;
    }>;
}

import { PublicKey } from '@solana/web3.js';

export class DiscordNotifier {
    private readonly webhookUrl: string;

    constructor(webhookUrl: string) {
        this.webhookUrl = webhookUrl;
    }

    async sendMigrationAlert(tokenMint: string, signature: string, connection: any): Promise<void> {
        try {
            // Fetch token metadata to get name and symbol
            let tokenName = 'Unknown';
            let tokenSymbol = 'Unknown';
            
            try {
                // Get metadata account address (Metaplex format)
                const metadataAddress = await this.getMetadataAddress(tokenMint);
                const metadataAccount = await connection.getAccountInfo(metadataAddress);
                
                if (metadataAccount && metadataAccount.data) {
                    // Parse Metaplex token metadata
                    const metadata = this.parseMetaplexMetadata(metadataAccount.data);
                    tokenName = metadata.name || 'Unknown';
                    tokenSymbol = metadata.symbol || 'Unknown';
                }
            } catch (error) {
                console.log('Could not fetch token metadata, using defaults');
            }

            const payload: DiscordWebhookPayload = {
                embeds: [{
                    title: '🎓 Pump.fun Migration Detected!',
                    description: 'A new token has graduated from Pump.fun!',
                    color: 0x00ff00, // Green color
                    fields: [
                        {
                            name: '🪙 Token Name',
                            value: tokenName,
                            inline: true
                        },
                        {
                            name: '🔤 Symbol',
                            value: tokenSymbol,
                            inline: true
                        },
                        {
                            name: '📋 Token Contract',
                            value: `\`${tokenMint}\``,
                            inline: false
                        },
                        {
                            name: '🔗 Transaction',
                            value: `[View on Solscan](https://solscan.io/tx/${signature})`,
                            inline: true
                        },
                        {
                            name: '⏰ Timestamp',
                            value: new Date().toISOString(),
                            inline: true
                        }
                    ],
                    timestamp: new Date().toISOString()
                }]
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

            console.log('📢 Discord notification sent successfully');
        } catch (error) {
            console.error('❌ Failed to send Discord notification:', error);
        }
    }

    async sendPoolAlert(embed: any): Promise<void> {
        try {
            const payload: DiscordWebhookPayload = {
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

            console.log('📢 Pool alert Discord notification sent successfully');
        } catch (error) {
            console.error('❌ Failed to send pool alert Discord notification:', error);
        }
    }

    private async getMetadataAddress(mintAddress: string): Promise<PublicKey> {
        // Metaplex metadata program ID
        const METADATA_PROGRAM_ID = new PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s');
        
        // Derive metadata account address
        const [metadataAddress] = await PublicKey.findProgramAddress(
            [
                Buffer.from('metadata'),
                METADATA_PROGRAM_ID.toBuffer(),
                new PublicKey(mintAddress).toBuffer(),
            ],
            METADATA_PROGRAM_ID
        );
        
        return metadataAddress;
    }

    private parseMetaplexMetadata(data: Buffer): { name: string; symbol: string } {
        try {
            // Metaplex metadata parsing
            // Skip the first 1 byte (discriminator)
            let offset = 1;
            
            // Skip authority (32 bytes)
            offset += 32;
            
            // Skip mint (32 bytes)  
            offset += 32;
            
            // Read name length (4 bytes)
            const nameLength = data.readUInt32LE(offset);
            offset += 4;
            
            // Read name
            const name = data.slice(offset, offset + nameLength).toString('utf8').replace(/\0/g, '').trim();
            offset += nameLength;
            
            // Read symbol length (4 bytes)
            const symbolLength = data.readUInt32LE(offset);
            offset += 4;
            
            // Read symbol
            const symbol = data.slice(offset, offset + symbolLength).toString('utf8').replace(/\0/g, '').trim();
            
            return { name, symbol };
        } catch (error) {
            console.log('Error parsing Metaplex metadata:', error);
            return { name: 'Unknown', symbol: 'Unknown' };
        }
    }
}
