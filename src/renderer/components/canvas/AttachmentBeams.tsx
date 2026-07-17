import type { Agent, Folder } from '../../../shared/types';
import { getAgentCenter, getFolderCenter } from '../../screens/workspace/attachLayout';

interface AttachmentBeamsProps {
  agents: Agent[];
  folders: Folder[];
}

export default function AttachmentBeams({ agents, folders }: AttachmentBeamsProps) {
  const beams = agents
    .map((agent) => {
      let targetFolderId = agent.attachedFolderId;
      if (!targetFolderId && agent.movementIntent?.intentType === 'move+attach') {
        targetFolderId = agent.movementIntent.targetId;
      }
      if (!targetFolderId) return null;
      const folder = folders.find((entry) => entry.id === targetFolderId);
      if (!folder) return null;
      return {
        id: agent.id,
        from: getAgentCenter(agent),
        to: getFolderCenter(folder),
      };
    })
    .filter((beam): beam is NonNullable<typeof beam> => beam !== null);

  if (beams.length === 0) return null;

  return (
    <svg className="attach-beams" aria-hidden="true">
      <defs>
        <linearGradient id="beam-gradient" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="rgba(80, 200, 255, 0.9)" />
          <stop offset="50%" stopColor="rgba(130, 220, 255, 1)" />
          <stop offset="100%" stopColor="rgba(80, 200, 255, 0.9)" />
        </linearGradient>
      </defs>
      {beams.map((beam) => (
        <g key={beam.id}>
          <line
            className="attach-beam-glow"
            x1={beam.from.x}
            y1={beam.from.y}
            x2={beam.to.x}
            y2={beam.to.y}
          />
          <line
            className="attach-beam"
            x1={beam.from.x}
            y1={beam.from.y}
            x2={beam.to.x}
            y2={beam.to.y}
            data-testid="attach-beam"
            data-agent-id={beam.id}
          />
          <line
            className="attach-beam-core"
            x1={beam.from.x}
            y1={beam.from.y}
            x2={beam.to.x}
            y2={beam.to.y}
          />
        </g>
      ))}
    </svg>
  );
}
