'use client';

import React, { useState, useEffect } from 'react';
import Room from './Room';

// Interfaces pour les données du World
interface RoomConfig {
  name: string;
  balancingStrategy: 'round-robin' | 'least-connections' | 'random';
  public: boolean;
  maxPlayersPerShard: number;
  minShards: number;
  maxShards?: number;
}

interface ShardInfo {
  id: string;
  url: string;
  connections: number;
  capacity: number;
  status?: string;
}

interface RoomInfo {
  roomId: string;
  config: RoomConfig;
  shards: ShardInfo[];
  metrics: {
    totalConnections: number;
    totalCapacity: number;
    utilizationPercentage: number;
  };
}

interface WorldInfo {
  rooms: RoomInfo[];
}

// Composant qui affiche un loading spinner
const LoadingSpinner = () => (
  <div className="loading-spinner">
    <div className="spinner"></div>
    <style jsx>{`
      .loading-spinner {
        display: flex;
        justify-content: center;
        align-items: center;
        height: 100px;
      }
      .spinner {
        border: 4px solid rgba(0, 0, 0, 0.1);
        width: 36px;
        height: 36px;
        border-radius: 50%;
        border-left-color: #2563eb;
        animation: spin 1s linear infinite;
      }
      @keyframes spin {
        0% { transform: rotate(0deg); }
        100% { transform: rotate(360deg); }
      }
    `}</style>
  </div>
);

// Composant pour afficher une barre de progression
const ProgressBar = ({ percentage }: { percentage: number }) => {
  const barColor = 
    percentage < 60 ? '#22c55e' :  // vert si <60%
    percentage < 80 ? '#f59e0b' :  // jaune si <80%
    '#ef4444';                    // rouge si >=80%
  
  return (
    <div className="progress-container">
      <div 
        className="progress-bar" 
        style={{ width: `${percentage}%`, backgroundColor: barColor }}
      ></div>
      <span className="progress-label">{percentage}%</span>
      <style jsx>{`
        .progress-container {
          width: 100%;
          height: 20px;
          background-color: #e5e7eb;
          border-radius: 10px;
          position: relative;
          overflow: hidden;
        }
        .progress-bar {
          height: 100%;
          border-radius: 10px;
          transition: width 0.3s ease;
        }
        .progress-label {
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          color: #fff;
          font-weight: bold;
          text-shadow: 1px 1px 2px rgba(0, 0, 0, 0.5);
        }
      `}</style>
    </div>
  );
};

// Composant pour une carte de salle
const RoomCard = ({ room, onSelect }: { room: RoomInfo; onSelect: () => void }) => {
  return (
    <div className="room-card" onClick={onSelect}>
      <h3>{room.config.name} <span className="room-id">({room.roomId})</span></h3>
      <div className="room-stats">
        <div className="stat">
          <span className="label">Shards:</span> 
          <span className="value">{room.shards.length}</span>
        </div>
        <div className="stat">
          <span className="label">Utilisateurs:</span> 
          <span className="value">{room.metrics.totalConnections} / {room.metrics.totalCapacity}</span>
        </div>
        <div className="stat">
          <span className="label">Utilisation:</span>
        </div>
        <ProgressBar percentage={room.metrics.utilizationPercentage} />
      </div>
      <style jsx>{`
        .room-card {
          background: white;
          border-radius: 8px;
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
          padding: 16px;
          margin-bottom: 16px;
          cursor: pointer;
          transition: all 0.2s;
        }
        .room-card:hover {
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
          transform: translateY(-2px);
        }
        .room-id {
          color: #6b7280;
          font-size: 0.9em;
        }
        .room-stats {
          margin-top: 12px;
        }
        .stat {
          display: flex;
          justify-content: space-between;
          margin-bottom: 8px;
        }
        .label {
          font-weight: 500;
          color: #374151;
        }
        .value {
          font-weight: 600;
        }
      `}</style>
    </div>
  );
};

// Composant pour une carte de shard
const ShardCard = ({ shard }: { shard: ShardInfo }) => {
  const statusColor = 
    shard.status === 'active' ? '#22c55e' :
    shard.status === 'draining' ? '#f59e0b' : 
    shard.status === 'maintenance' ? '#3b82f6' : '#6b7280';
  
  const utilizationPercentage = Math.round((shard.connections / shard.capacity) * 100) || 0;
  
  return (
    <div className="shard-card">
      <div className="shard-header">
        <h4 className="shard-title">Shard: {shard.id.split('-').pop()}</h4>
        <div className="status-badge" style={{ backgroundColor: statusColor }}>
          {shard.status || 'unknown'}
        </div>
      </div>
      
      <div className="shard-url">{shard.url}</div>
      
      <div className="shard-stats">
        <div className="stat">
          <span className="label">Connexions:</span>
          <span className="value">{shard.connections} / {shard.capacity}</span>
        </div>
        <div className="stat">
          <span className="label">Utilisation:</span>
        </div>
        <ProgressBar percentage={utilizationPercentage} />
      </div>
      
      <style jsx>{`
        .shard-card {
          background: #f9fafb;
          border-radius: 6px;
          padding: 12px;
          margin-bottom: 12px;
          border: 1px solid #e5e7eb;
        }
        .shard-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 8px;
        }
        .shard-title {
          margin: 0;
          font-size: 1rem;
          font-weight: 600;
        }
        .status-badge {
          padding: 4px 8px;
          border-radius: 9999px;
          font-size: 0.75rem;
          color: white;
          text-transform: capitalize;
        }
        .shard-url {
          font-family: monospace;
          font-size: 0.8rem;
          color: #6b7280;
          margin-bottom: 8px;
          word-break: break-all;
        }
        .shard-stats {
          margin-top: 8px;
        }
        .stat {
          display: flex;
          justify-content: space-between;
          margin-bottom: 6px;
          font-size: 0.9rem;
        }
        .label {
          font-weight: 500;
          color: #374151;
        }
        .value {
          font-weight: 600;
        }
      `}</style>
    </div>
  );
};

// Formulaire pour créer une salle
const CreateRoomForm = ({ worldId, onRoomCreated }: { worldId: string; onRoomCreated: () => void }) => {
  const [name, setName] = useState('');
  const [balancingStrategy, setBalancingStrategy] = useState<'round-robin' | 'least-connections' | 'random'>('round-robin');
  const [isPublic, setIsPublic] = useState(true);
  const [maxPlayers, setMaxPlayers] = useState(100);
  const [minShards, setMinShards] = useState(1);
  const [maxShards, setMaxShards] = useState(10);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError('');
    
    try {
      const roomId = name.toLowerCase().replace(/\s+/g, '-');
      
      const response = await fetch(`/parties/world/${worldId}?action=register-room`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          roomId,
          config: {
            name,
            balancingStrategy,
            public: isPublic,
            maxPlayersPerShard: maxPlayers,
            minShards,
            maxShards
          }
        })
      });
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Erreur lors de la création de la salle');
      }
      
      onRoomCreated();
      
      // Reset form
      setName('');
      setBalancingStrategy('round-robin');
      setIsPublic(true);
      setMaxPlayers(100);
      setMinShards(1);
      setMaxShards(10);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };
  
  return (
    <div className="create-room-form">
      <h3>Créer une nouvelle salle</h3>
      
      {error && <div className="error-message">{error}</div>}
      
      <form onSubmit={handleSubmit}>
        <div className="form-group">
          <label htmlFor="name">Nom de la salle</label>
          <input
            type="text"
            id="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
        </div>
        
        <div className="form-group">
          <label htmlFor="balancingStrategy">Stratégie d'équilibrage</label>
          <select
            id="balancingStrategy"
            value={balancingStrategy}
            onChange={(e) => setBalancingStrategy(e.target.value as any)}
            required
          >
            <option value="round-robin">Round Robin</option>
            <option value="least-connections">Moins de connexions</option>
            <option value="random">Aléatoire</option>
          </select>
        </div>
        
        <div className="form-group">
          <label htmlFor="isPublic">Visibilité</label>
          <div className="toggle-container">
            <input
              type="checkbox"
              id="isPublic"
              checked={isPublic}
              onChange={(e) => setIsPublic(e.target.checked)}
            />
            <label htmlFor="isPublic" className="toggle-label">
              {isPublic ? 'Publique' : 'Privée'}
            </label>
          </div>
        </div>
        
        <div className="form-group">
          <label htmlFor="maxPlayers">Joueurs max par shard</label>
          <input
            type="number"
            id="maxPlayers"
            value={maxPlayers}
            onChange={(e) => setMaxPlayers(parseInt(e.target.value))}
            min="1"
            required
          />
        </div>
        
        <div className="form-group">
          <label htmlFor="minShards">Nombre min. de shards</label>
          <input
            type="number"
            id="minShards"
            value={minShards}
            onChange={(e) => setMinShards(parseInt(e.target.value))}
            min="1"
            required
          />
        </div>
        
        <div className="form-group">
          <label htmlFor="maxShards">Nombre max. de shards</label>
          <input
            type="number"
            id="maxShards"
            value={maxShards}
            onChange={(e) => setMaxShards(parseInt(e.target.value))}
            min={minShards}
            required
          />
        </div>
        
        <button type="submit" className="submit-button" disabled={isLoading}>
          {isLoading ? 'Création...' : 'Créer la salle'}
        </button>
      </form>
      
      <style jsx>{`
        .create-room-form {
          background: white;
          border-radius: 8px;
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
          padding: 16px;
          margin-bottom: 24px;
        }
        .error-message {
          background-color: #fee2e2;
          border: 1px solid #ef4444;
          color: #b91c1c;
          padding: 8px 12px;
          border-radius: 4px;
          margin-bottom: 16px;
        }
        .form-group {
          margin-bottom: 16px;
        }
        label {
          display: block;
          margin-bottom: 6px;
          font-weight: 500;
          color: #374151;
        }
        input[type="text"],
        input[type="number"],
        select {
          width: 100%;
          padding: 8px 12px;
          border: 1px solid #d1d5db;
          border-radius: 4px;
          font-size: 16px;
        }
        input[type="checkbox"] {
          margin-right: 8px;
        }
        .toggle-container {
          display: flex;
          align-items: center;
        }
        .toggle-label {
          margin-bottom: 0;
        }
        .submit-button {
          background-color: #2563eb;
          color: white;
          border: none;
          border-radius: 4px;
          padding: 8px 16px;
          font-size: 16px;
          cursor: pointer;
          transition: background-color 0.2s;
        }
        .submit-button:hover {
          background-color: #1d4ed8;
        }
        .submit-button:disabled {
          background-color: #93c5fd;
          cursor: not-allowed;
        }
      `}</style>
    </div>
  );
};

// Formulaire pour le scaling d'une salle
const ScaleRoomForm = ({ worldId, room, onScaled }: { worldId: string; room: RoomInfo; onScaled: () => void }) => {
  const [targetShardCount, setTargetShardCount] = useState(room.shards.length);
  const [urlTemplate, setUrlTemplate] = useState('wss://shard-{shardId}.example.com');
  const [maxConnections, setMaxConnections] = useState(room.config.maxPlayersPerShard);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  
  // Met à jour les valeurs par défaut quand la salle change
  useEffect(() => {
    setTargetShardCount(room.shards.length);
    setMaxConnections(room.config.maxPlayersPerShard);
    // Essaie de déduire un modèle d'URL à partir des shards existants
    if (room.shards.length > 0) {
      const sampleUrl = room.shards[0].url;
      setUrlTemplate(sampleUrl.replace(room.shards[0].id, '{shardId}'));
    }
  }, [room]);
  
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError('');
    
    try {
      const response = await fetch(`/parties/world/${worldId}?action=scale-room`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          roomId: room.roomId,
          targetShardCount,
          shardTemplate: {
            urlTemplate,
            maxConnections
          }
        })
      });
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Erreur lors du scaling de la salle');
      }
      
      onScaled();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };
  
  return (
    <div className="scale-room-form">
      <h3>Ajuster le nombre de shards</h3>
      
      {error && <div className="error-message">{error}</div>}
      
      <form onSubmit={handleSubmit}>
        <div className="form-group">
          <label htmlFor="targetShardCount">Nombre cible de shards</label>
          <input
            type="number"
            id="targetShardCount"
            value={targetShardCount}
            onChange={(e) => setTargetShardCount(parseInt(e.target.value))}
            min={room.config.minShards}
            max={room.config.maxShards || 100}
            required
          />
          <div className="constraints">
            Min: {room.config.minShards}, Max: {room.config.maxShards || '∞'}
          </div>
        </div>
        
        <div className="form-group">
          <label htmlFor="urlTemplate">Modèle d'URL pour nouveaux shards</label>
          <input
            type="text"
            id="urlTemplate"
            value={urlTemplate}
            onChange={(e) => setUrlTemplate(e.target.value)}
            required
          />
          <div className="hint">Utilisez {'{shardId}'} comme placeholder</div>
        </div>
        
        <div className="form-group">
          <label htmlFor="maxConnections">Connexions max par shard</label>
          <input
            type="number"
            id="maxConnections"
            value={maxConnections}
            onChange={(e) => setMaxConnections(parseInt(e.target.value))}
            min="1"
            required
          />
        </div>
        
        <button type="submit" className="submit-button" disabled={isLoading}>
          {isLoading ? 'Mise à jour...' : 'Mettre à jour les shards'}
        </button>
      </form>
      
      <style jsx>{`
        .scale-room-form {
          background: white;
          border-radius: 8px;
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
          padding: 16px;
          margin-bottom: 24px;
        }
        .error-message {
          background-color: #fee2e2;
          border: 1px solid #ef4444;
          color: #b91c1c;
          padding: 8px 12px;
          border-radius: 4px;
          margin-bottom: 16px;
        }
        .form-group {
          margin-bottom: 16px;
        }
        label {
          display: block;
          margin-bottom: 6px;
          font-weight: 500;
          color: #374151;
        }
        input[type="text"],
        input[type="number"] {
          width: 100%;
          padding: 8px 12px;
          border: 1px solid #d1d5db;
          border-radius: 4px;
          font-size: 16px;
        }
        .constraints, .hint {
          margin-top: 4px;
          font-size: 0.8rem;
          color: #6b7280;
        }
        .submit-button {
          background-color: #2563eb;
          color: white;
          border: none;
          border-radius: 4px;
          padding: 8px 16px;
          font-size: 16px;
          cursor: pointer;
          transition: background-color 0.2s;
        }
        .submit-button:hover {
          background-color: #1d4ed8;
        }
        .submit-button:disabled {
          background-color: #93c5fd;
          cursor: not-allowed;
        }
      `}</style>
    </div>
  );
};

// Composant principal de l'administration
const WorldAdmin = () => {
  const [worldId, setWorldId] = useState('default');
  const [worldInfo, setWorldInfo] = useState<WorldInfo | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  
  // Récupère les informations du World
  useEffect(() => {
    const fetchWorldInfo = async () => {
      setIsLoading(true);
      setError(null);
      
      try {
        const response = await fetch(`/parties/world/${worldId}?action=room-info`);
        
        if (!response.ok) {
          throw new Error(`Erreur lors de la récupération des données: ${response.status}`);
        }
        
        const data = await response.json();
        setWorldInfo(data);
        
        // Sélectionne la première salle par défaut si aucune n'est sélectionnée
        if (!selectedRoomId && data.rooms && data.rooms.length > 0) {
          setSelectedRoomId(data.rooms[0].roomId);
        }
      } catch (err: any) {
        setError(err.message);
        console.error("Erreur:", err);
      } finally {
        setIsLoading(false);
      }
    };
    
    fetchWorldInfo();
    
    // Configure un rafraîchissement automatique toutes les 30 secondes
    const intervalId = setInterval(() => {
      setRefreshTrigger(prev => prev + 1);
    }, 30000);
    
    return () => clearInterval(intervalId);
  }, [worldId, refreshTrigger]);
  
  // Salle sélectionnée
  const selectedRoom = worldInfo?.rooms.find(room => room.roomId === selectedRoomId);
  
  // Gestion du rafraîchissement
  const handleRefresh = () => {
    setRefreshTrigger(prev => prev + 1);
  };
  
  // Handler pour la création d'une salle
  const handleRoomCreated = () => {
    handleRefresh();
  };
  
  // Handler pour le scaling d'une salle
  const handleRoomScaled = () => {
    handleRefresh();
  };
  
  return (
    <div className="world-admin">
      <div className="admin-header">
        <h1>Administration World</h1>
        <div className="world-selector">
          <label htmlFor="worldId">ID du World:</label>
          <input
            type="text"
            id="worldId"
            value={worldId}
            onChange={(e) => setWorldId(e.target.value)}
          />
        </div>
        <button className="refresh-button" onClick={handleRefresh}>
          Rafraîchir
        </button>
      </div>
      
      {error && (
        <div className="error-banner">
          {error}
        </div>
      )}
      
      {isLoading ? (
        <LoadingSpinner />
      ) : (
        <div className="admin-content">
          <div className="rooms-list">
            <h2>Salles ({worldInfo?.rooms.length || 0})</h2>
            
            <CreateRoomForm 
              worldId={worldId} 
              onRoomCreated={handleRoomCreated} 
            />
            
            {worldInfo?.rooms.map(room => (
              <RoomCard 
                key={room.roomId} 
                room={room} 
                onSelect={() => setSelectedRoomId(room.roomId)} 
              />
            ))}
            
            {worldInfo?.rooms.length === 0 && (
              <div className="no-rooms">
                Aucune salle enregistrée. Créez-en une avec le formulaire ci-dessus.
              </div>
            )}
          </div>
          
          <div className="room-details">
            {selectedRoom ? (
              <>
                <div className="room-header">
                  <h2>{selectedRoom.config.name}</h2>
                  <div className="room-id-badge">{selectedRoom.roomId}</div>
                </div>
                
                <div className="room-metrics">
                  <div className="metric-card">
                    <div className="metric-title">Connexions totales</div>
                    <div className="metric-value">{selectedRoom.metrics.totalConnections} / {selectedRoom.metrics.totalCapacity}</div>
                    <ProgressBar percentage={selectedRoom.metrics.utilizationPercentage} />
                  </div>
                  
                  <div className="metric-card">
                    <div className="metric-title">Nombre de shards</div>
                    <div className="metric-value">{selectedRoom.shards.length}</div>
                    <div className="metric-subtitle">
                      Min: {selectedRoom.config.minShards}, 
                      Max: {selectedRoom.config.maxShards || '∞'}
                    </div>
                  </div>
                  
                  <div className="metric-card">
                    <div className="metric-title">Stratégie</div>
                    <div className="metric-value">{selectedRoom.config.balancingStrategy}</div>
                    <div className="metric-subtitle">
                      {selectedRoom.config.public ? 'Publique' : 'Privée'}
                    </div>
                  </div>
                </div>
                
                <ScaleRoomForm 
                  worldId={worldId}
                  room={selectedRoom}
                  onScaled={handleRoomScaled}
                />
                
                <h3>Shards ({selectedRoom.shards.length})</h3>
                
                <div className="shards-grid">
                  {selectedRoom.shards.map(shard => (
                    <ShardCard key={shard.id} shard={shard} />
                  ))}
                  
                  {selectedRoom.shards.length === 0 && (
                    <div className="no-shards">
                      Aucun shard pour cette salle. Utilisez le formulaire ci-dessus pour en ajouter.
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div className="no-room-selected">
                Sélectionnez une salle dans la liste pour voir ses détails.
              </div>
            )}
          </div>
        </div>
      )}

      <Room />
      
      <style jsx>{`
        .world-admin {
          padding: 20px;
          max-width: 1200px;
          margin: 0 auto;
        }
        .admin-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 24px;
        }
        .world-selector {
          display: flex;
          align-items: center;
        }
        .world-selector label {
          margin-right: 8px;
        }
        .world-selector input {
          padding: 6px 12px;
          border: 1px solid #d1d5db;
          border-radius: 4px;
        }
        .refresh-button {
          background-color: #f3f4f6;
          border: 1px solid #d1d5db;
          border-radius: 4px;
          padding: 6px 12px;
          cursor: pointer;
          transition: background-color 0.2s;
        }
        .refresh-button:hover {
          background-color: #e5e7eb;
        }
        .error-banner {
          background-color: #fee2e2;
          border: 1px solid #ef4444;
          color: #b91c1c;
          padding: 12px 16px;
          border-radius: 4px;
          margin-bottom: 24px;
        }
        .admin-content {
          display: grid;
          grid-template-columns: 1fr 2fr;
          gap: 24px;
        }
        .rooms-list {
          background: #f9fafb;
          border-radius: 8px;
          padding: 16px;
        }
        .room-details {
          background: #f9fafb;
          border-radius: 8px;
          padding: 16px;
        }
        .room-header {
          display: flex;
          align-items: center;
          margin-bottom: 16px;
        }
        .room-id-badge {
          background: #e5e7eb;
          border-radius: 9999px;
          padding: 4px 12px;
          margin-left: 12px;
          font-size: 0.9rem;
          color: #374151;
        }
        .room-metrics {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
          gap: 16px;
          margin-bottom: 24px;
        }
        .metric-card {
          background: white;
          border-radius: 8px;
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
          padding: 16px;
        }
        .metric-title {
          font-size: 0.9rem;
          color: #6b7280;
          margin-bottom: 8px;
        }
        .metric-value {
          font-size: 1.5rem;
          font-weight: 600;
          margin-bottom: 8px;
        }
        .metric-subtitle {
          font-size: 0.8rem;
          color: #6b7280;
        }
        .shards-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
          gap: 16px;
        }
        .no-rooms, .no-shards, .no-room-selected {
          background: white;
          border-radius: 8px;
          padding: 32px;
          text-align: center;
          color: #6b7280;
        }
      `}</style>
    </div>
  );
};

export default WorldAdmin;
