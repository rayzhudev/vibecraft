import type { CommandInvocation } from '../../commands/registry';
import { entityIcons, providerIcons } from '../../assets/icons';

interface WorldAbilityPanelProps {
  onAbility: (ability: CommandInvocation) => void;
}

export default function WorldAbilityPanel({ onAbility }: WorldAbilityPanelProps) {
  return (
    <div className="world-ability-panel">
      <button
        className="world-ability-btn"
        onClick={() => onAbility({ id: 'create-agent-claude' })}
        data-testid="world-ability-create-agent-claude"
        data-tutorial-target="ability-create-agent-claude"
      >
        <img className="world-ability-icon" src={providerIcons.claude} alt="Claude" />
        <span className="world-ability-label">Claude Agent</span>
      </button>
      <button
        className="world-ability-btn"
        onClick={() => onAbility({ id: 'create-agent-google' })}
        data-testid="world-ability-create-agent-google"
        data-tutorial-target="ability-create-agent-google"
      >
        <img className="world-ability-icon" src={providerIcons.google} alt="Gemini" />
        <span className="world-ability-label">Gemini Agent</span>
      </button>
      <button
        className="world-ability-btn"
        onClick={() => onAbility({ id: 'create-agent-codex' })}
        data-testid="world-ability-create-agent-codex"
        data-tutorial-target="ability-create-agent-codex"
      >
        <img className="world-ability-icon" src={providerIcons.codex} alt="Codex" />
        <span className="world-ability-label">Codex Agent</span>
      </button>
      <button
        className="world-ability-btn"
        onClick={() => onAbility({ id: 'create-folder' })}
        data-testid="world-ability-create-folder"
        data-tutorial-target="ability-create-folder"
      >
        <img className="world-ability-icon" src={entityIcons.folder} alt="Folder" />
        <span className="world-ability-label">Project</span>
      </button>
      <button
        className="world-ability-btn"
        onClick={() => onAbility({ id: 'create-terminal' })}
        data-testid="world-ability-create-terminal"
        data-tutorial-target="ability-create-terminal"
      >
        <img className="world-ability-icon" src={entityIcons.terminal} alt="Terminal" />
        <span className="world-ability-label">Terminal</span>
      </button>
      <button
        className="world-ability-btn"
        onClick={() => onAbility({ id: 'create-browser' })}
        data-testid="world-ability-create-browser"
        data-tutorial-target="ability-create-browser"
      >
        <img className="world-ability-icon" src={entityIcons.browser} alt="Browser" />
        <span className="world-ability-label">Browser</span>
      </button>
    </div>
  );
}
