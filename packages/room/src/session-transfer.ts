import type * as Party from "./types/party";

export interface SessionData {
  publicId: string;
  state?: any;
  created: number;
  connected: boolean;
  transferData?: any; // Additional data that can be transferred between rooms
  lastRoomId?: string; // Track the last room the session was active in
  transferToken?: string; // Temporary token for secure transfers
  transferExpiry?: number; // When the transfer token expires
}

export interface SessionTransferMetadata {
  sourceRoomId: string;
  targetRoomId: string;
  timestamp: number;
  transferId: string;
}

export class SessionTransferService {
  private storage: Party.Storage;
  private roomId: string;

  constructor(storage: Party.Storage, roomId: string) {
    this.storage = storage;
    this.roomId = roomId;
  }

  /**
   * Prepares a session for transfer to another room
   * @param privateId The private ID of the session
   * @param targetRoomId The target room ID
   * @param transferData Additional data to transfer
   * @returns Transfer token or null if session not found
   */
  async prepareSessionTransfer(
    privateId: string, 
    targetRoomId: string, 
    transferData?: any
  ): Promise<string | null> {
    const session = await this.getSession(privateId);
    if (!session) {
      return null;
    }

    // Generate transfer token
    const transferToken = this.generateTransferToken();
    const transferExpiry = Date.now() + (5 * 60 * 1000); // 5 minutes expiry

    // Update session with transfer data
    const updatedSession: SessionData = {
      ...session,
      transferData,
      lastRoomId: this.roomId,
      transferToken,
      transferExpiry
    };

    await this.saveSession(privateId, updatedSession);

    // Store transfer metadata globally
    const transferMetadata: SessionTransferMetadata = {
      sourceRoomId: this.roomId,
      targetRoomId,
      timestamp: Date.now(),
      transferId: transferToken
    };

    await this.storage.put(`transfer:${transferToken}`, transferMetadata as any);

    return transferToken;
  }

  /**
   * Validates and consumes a transfer token
   * @param transferToken The transfer token
   * @param expectedTargetRoomId The expected target room ID
   * @returns Session data if valid, null otherwise
   */
  async validateTransferToken(
    transferToken: string, 
    expectedTargetRoomId: string
  ): Promise<{ privateId: string; sessionData: SessionData } | null> {
    // Get transfer metadata
    const transferMetadata = await this.storage.get(`transfer:${transferToken}`) as SessionTransferMetadata | undefined;
    if (!transferMetadata) {
      return null;
    }

    // Validate transfer
    if (transferMetadata.targetRoomId !== expectedTargetRoomId) {
      return null;
    }

    // Find session with this transfer token
    const sessions = await this.storage.list();
    for (const [key, sessionData] of sessions) {
      if (!key.startsWith('session:')) continue;
      
      const session = sessionData as SessionData;
      if (session.transferToken === transferToken) {
        // Check if token is still valid
        if (session.transferExpiry && Date.now() > session.transferExpiry) {
          // Clean up expired transfer
          await this.cleanupTransfer(transferToken, key.replace('session:', ''));
          return null;
        }

        const privateId = key.replace('session:', '');
        return { privateId, sessionData: session };
      }
    }

    return null;
  }

  /**
   * Completes a session transfer by moving the session to the current room
   * @param privateId The private ID of the session
   * @param sessionData The session data from the transfer
   */
  async completeSessionTransfer(privateId: string, sessionData: SessionData): Promise<void> {
    // Clean up transfer token and metadata
    if (sessionData.transferToken) {
      await this.cleanupTransfer(sessionData.transferToken, privateId);
    }

    // Save session in current room, keeping transfer data temporarily for onSessionTransfer
    const cleanSessionData: SessionData = {
      ...sessionData,
      connected: true,
      transferToken: undefined,
      transferExpiry: undefined,
      lastRoomId: this.roomId,
      // Keep transferData temporarily - it will be cleaned up after onSessionTransfer is called
      transferData: sessionData.transferData
    };

    await this.saveSession(privateId, cleanSessionData);
  }

  /**
   * Checks if a session exists for the given private ID
   * @param privateId The private ID to check
   * @returns True if session exists, false otherwise
   */
  async hasValidSession(privateId: string): Promise<boolean> {
    const session = await this.getSession(privateId);
    return !!session;
  }

  /**
   * Gets session data for cross-room validation
   * @param privateId The private ID
   * @returns Session data if exists
   */
  async getSessionForValidation(privateId: string): Promise<SessionData | null> {
    return await this.getSession(privateId);
  }

  /**
   * Cleans up transfer data from a session after it has been processed
   * @param privateId The private ID of the session
   */
  async cleanupSessionTransferData(privateId: string): Promise<void> {
    const session = await this.getSession(privateId);
    if (session && session.transferData) {
      const cleanSession: SessionData = {
        ...session,
        transferData: undefined
      };
      await this.saveSession(privateId, cleanSession);
    }
  }

  private async getSession(privateId: string): Promise<SessionData | null> {
    if (!privateId) return null;
    try {
      const session = await this.storage.get(`session:${privateId}`);
      return session ? (session as SessionData) : null;
    } catch (e) {
      return null;
    }
  }

  private async saveSession(privateId: string, data: SessionData): Promise<void> {
    await this.storage.put(`session:${privateId}`, data as any);
  }

  private generateTransferToken(): string {
    return `transfer_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private async cleanupTransfer(transferToken: string, privateId: string): Promise<void> {
    // Remove transfer metadata
    await this.storage.delete(`transfer:${transferToken}`);
    
    // Clean up session transfer data
    const session = await this.getSession(privateId);
    if (session && session.transferToken === transferToken) {
      const cleanSession: SessionData = {
        ...session,
        transferToken: undefined,
        transferExpiry: undefined,
        transferData: undefined
      };
      await this.saveSession(privateId, cleanSession);
    }
  }
}