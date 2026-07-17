import React from 'react';
import type { Agent } from '../../../shared/types';
import { getProviderIconUrl } from '../../utils/providerIcons';
import { useProviderAuthBadge } from '../../utils/useProviderAuthBadge';
import { getContextMeter } from '../../utils/contextMeter';
import UnitEntity from './UnitEntity';
import SelectionIndicator from './SelectionIndicator';
import TokenFloater from './TokenFloater';
import { entityIcons } from '../../assets/icons';

interface AgentEntityProps {
  agent: Agent;
  selected: boolean;
  previewed?: boolean;
  reduceEffects?: boolean;
  onSelect: (event?: React.MouseEvent) => void;
  onMove: (x: number, y: number) => void;
  onDragStart?: () => void;
  onDragEnd?: (data?: { pos: { x: number; y: number }; dragDistance: number }) => void;
  isTerminalOpen?: boolean;
  showCompletionBadge?: boolean;
}

const statusColors: Record<string, string> = {
  online: 'var(--success)',
  offline: 'var(--text-muted)',
  working: 'var(--warning)',
  error: 'var(--error)',
};

export default function AgentEntity({
  agent,
  selected,
  previewed = false,
  reduceEffects = false,
  onSelect,
  onMove,
  onDragStart,
  onDragEnd,
  isTerminalOpen,
  showCompletionBadge = false,
}: AgentEntityProps) {
  const isOnline = agent.status === 'online' || agent.status === 'working';
  const isThinking = agent.status === 'working';

  const { percent: contextPercent, variant: contextVariant } = getContextMeter(agent.contextLeft);
  const authBadge = useProviderAuthBadge(agent.provider);

  return (
    <UnitEntity
      x={agent.x}
      y={agent.y}
      entityType="agent"
      selected={selected}
      previewed={previewed}
      onSelect={onSelect}
      onMove={onMove}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      draggable={!agent.movementIntent}
      className={`agent-entity status-${agent.status} ${isOnline ? 'online' : ''} ${isThinking ? 'thinking' : ''} ${reduceEffects ? 'reduced-effects' : ''}`}
      testId="entity-agent"
      entityId={agent.id}
      entityName={agent.displayName}
    >
      {/* The unit container - icon is the center, other elements positioned around it */}
      <div className="agent-unit">
        {/* Hitbox centered on the unit icon */}
        <div className="unit-hitbox agent-hitbox" />

        {/* Selection circle centered on the icon */}
        <SelectionIndicator active={selected || previewed} variant="circle" />

        {/* Unit info above the icon */}
        <div className="unit-overhead">
          <div className="unit-nameplate" style={{ color: agent.color }}>
            {agent.displayName}
          </div>
          <div className={`unit-context-bar context-${contextVariant}`}>
            <div className="unit-context-fill" style={{ width: `${contextPercent}%` }} />
          </div>
        </div>

        <TokenFloater agentId={agent.id} reduceEffects={reduceEffects} />

        {/* The provider logo */}
        <img className="agent-icon" src={getProviderIconUrl(agent.provider)} alt={agent.provider} />
        <div
          className="status-indicator"
          style={{ backgroundColor: statusColors[agent.status] ?? 'var(--text-muted)' }}
          title={agent.status}
        />
        {showCompletionBadge && <div className="completion-indicator" aria-hidden="true" />}
        {authBadge && (
          <div
            className={`agent-auth-badge agent-auth-badge--${authBadge}`}
            title={authBadge === 'key' ? 'API Key' : 'Subscription'}
          >
            {authBadge === 'key' ? '🔑' : '🌐'}
          </div>
        )}
        {isTerminalOpen && (
          <div className="agent-terminal-badge" title="Terminal open">
            <img src={entityIcons.terminal} alt="Terminal" />
          </div>
        )}
      </div>
    </UnitEntity>
  );
}
