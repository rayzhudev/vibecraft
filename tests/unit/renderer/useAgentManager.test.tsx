import { act, render, screen, waitFor } from '@testing-library/react';
import { useCallback, useEffect, useState } from 'react';
import { expect, test, vi } from 'vitest';
import type { CommandRunResult } from '../../../src/shared/commands';
import type { Agent, AgentProvider, Folder, SelectedEntityRef } from '../../../src/shared/types';
import { useAgentManager } from '../../../src/renderer/screens/workspace/useAgentManager';
import type { DialogMessage } from '../../../src/renderer/screens/workspace/types';
import {
  getAttachSlotPosition,
  layoutAttachedAgents,
} from '../../../src/renderer/screens/workspace/attachLayout';

const agentsFixture: Agent[] = [
  {
    id: 'agent-1',
    provider: 'claude',
    model: '',
    color: '#ff0000',
    name: 'Claude',
    displayName: 'Claude',
    workspacePath: '/workspace',
    x: 0,
    y: 0,
    status: 'online',
    attachedFolderId: 'folder-1',
    contextLeft: 80,
  },
  {
    id: 'agent-2',
    provider: 'codex',
    model: '',
    color: '#00ff00',
    name: 'Codex',
    displayName: 'Codex',
    workspacePath: '/workspace',
    x: 0,
    y: 0,
    status: 'online',
    attachedFolderId: 'folder-1',
    contextLeft: 75,
  },
];

function Harness({ onReady }: { onReady: (open: (id: string) => Promise<void>) => void }) {
  const [agents, setAgents] = useState<Agent[]>(agentsFixture);
  const [activeAgentTerminalId, setActiveAgentTerminalId] = useState<string | null>(null);
  const [selectedEntity, setSelectedEntity] = useState<SelectedEntityRef | null>(null);
  const [, setSelectedAgentIds] = useState<string[]>([]);
  const folders: Folder[] = [];

  const closeAgentTerminals = useCallback((agentIds: Iterable<string>) => {
    const ids = new Set(agentIds);
    setActiveAgentTerminalId((prev) => (prev && ids.has(prev) ? null : prev));
  }, []);

  const { openAgentTerminal } = useAgentManager({
    workspacePath: '/workspace',
    agents,
    setAgents,
    folders,
    selectedEntity,
    setSelectedAgentIds,
    setSelectedEntity,
    setMessageDialog: vi.fn() as unknown as (msg: DialogMessage | null) => void,
    activeAgentTerminalId,
    setActiveAgentTerminalId,
    closeAgentTerminals,
  });

  useEffect(() => {
    onReady(async (id: string) => {
      await openAgentTerminal(id);
    });
  }, [onReady, openAgentTerminal]);

  return <div data-testid="active-agent-terminal">{activeAgentTerminalId ?? ''}</div>;
}

function CreateHarness({
  initialAgents,
  onReady,
}: {
  initialAgents: Agent[];
  onReady: (
    create: (provider: AgentProvider, x: number, y: number, attachedFolderId?: string) => Promise<void>
  ) => void;
}) {
  const [agents, setAgents] = useState<Agent[]>(initialAgents);
  const [activeAgentTerminalId, setActiveAgentTerminalId] = useState<string | null>(null);
  const [selectedEntity, setSelectedEntity] = useState<SelectedEntityRef | null>(null);
  const [, setSelectedAgentIds] = useState<string[]>([]);
  const folders: Folder[] = [];

  const closeAgentTerminals = useCallback((agentIds: Iterable<string>) => {
    const ids = new Set(agentIds);
    setActiveAgentTerminalId((prev) => (prev && ids.has(prev) ? null : prev));
  }, []);

  const { createAgent } = useAgentManager({
    workspacePath: '/workspace',
    agents,
    setAgents,
    folders,
    selectedEntity,
    setSelectedAgentIds,
    setSelectedEntity,
    setMessageDialog: vi.fn() as unknown as (msg: DialogMessage | null) => void,
    activeAgentTerminalId,
    setActiveAgentTerminalId,
    closeAgentTerminals,
  });

  useEffect(() => {
    onReady(async (provider, x, y, attachedFolderId) => {
      await createAgent(provider, x, y, attachedFolderId);
    });
  }, [createAgent, onReady]);

  return <div data-testid="agent-count">{agents.length}</div>;
}

function NameSequenceHarness({
  initialAgents,
  onReady,
}: {
  initialAgents: Agent[];
  onReady: (controls: {
    create: (provider: AgentProvider, x: number, y: number) => Promise<void>;
    reset: () => Promise<CommandRunResult>;
  }) => void;
}) {
  const [agents, setAgents] = useState<Agent[]>(initialAgents);
  const [activeAgentTerminalId, setActiveAgentTerminalId] = useState<string | null>(null);
  const [selectedEntity, setSelectedEntity] = useState<SelectedEntityRef | null>(null);
  const [, setSelectedAgentIds] = useState<string[]>([]);
  const folders: Folder[] = [];

  const closeAgentTerminals = useCallback((agentIds: Iterable<string>) => {
    const ids = new Set(agentIds);
    setActiveAgentTerminalId((prev) => (prev && ids.has(prev) ? null : prev));
  }, []);

  const { createAgent, resetAgentNameSequenceIndex } = useAgentManager({
    workspacePath: '/workspace',
    agents,
    setAgents,
    folders,
    selectedEntity,
    setSelectedAgentIds,
    setSelectedEntity,
    setMessageDialog: vi.fn() as unknown as (msg: DialogMessage | null) => void,
    activeAgentTerminalId,
    setActiveAgentTerminalId,
    closeAgentTerminals,
  });

  useEffect(() => {
    onReady({
      create: async (provider, x, y) => {
        await createAgent(provider, x, y);
      },
      reset: async () => resetAgentNameSequenceIndex(),
    });
  }, [createAgent, onReady, resetAgentNameSequenceIndex]);

  return <div data-testid="agent-count">{agents.length}</div>;
}

function AttachHarness({
  initialAgents,
  folders,
  onReady,
}: {
  initialAgents: Agent[];
  folders: Folder[];
  onReady: (controls: {
    attach: (
      agentId: string,
      folderId: string,
      targetPos?: { x: number; y: number }
    ) => Promise<CommandRunResult>;
    getAgents: () => Agent[];
  }) => void;
}) {
  const [agents, setAgents] = useState<Agent[]>(initialAgents);
  const [activeAgentTerminalId, setActiveAgentTerminalId] = useState<string | null>(null);
  const [selectedEntity, setSelectedEntity] = useState<SelectedEntityRef | null>(null);
  const [, setSelectedAgentIds] = useState<string[]>([]);

  const closeAgentTerminals = useCallback((agentIds: Iterable<string>) => {
    const ids = new Set(agentIds);
    setActiveAgentTerminalId((prev) => (prev && ids.has(prev) ? null : prev));
  }, []);

  const { attachAgentToFolder } = useAgentManager({
    workspacePath: '/workspace',
    agents,
    setAgents,
    folders,
    selectedEntity,
    setSelectedAgentIds,
    setSelectedEntity,
    setMessageDialog: vi.fn() as unknown as (msg: DialogMessage | null) => void,
    activeAgentTerminalId,
    setActiveAgentTerminalId,
    closeAgentTerminals,
  });

  useEffect(() => {
    onReady({
      attach: async (agentId, folderId, targetPos) => {
        return attachAgentToFolder(agentId, folderId, targetPos);
      },
      getAgents: () => agents,
    });
  }, [agents, attachAgentToFolder, onReady]);

  return null;
}

test('openAgentTerminal toggles and replaces the active agent terminal', async () => {
  let openAgentTerminal: (id: string) => Promise<void> = async () => {};

  render(<Harness onReady={(open) => (openAgentTerminal = open)} />);

  await waitFor(() => {
    expect(openAgentTerminal).not.toBeNull();
  });

  await act(async () => {
    await openAgentTerminal('agent-1');
  });
  expect(screen.getByTestId('active-agent-terminal')).toHaveTextContent('agent-1');

  await act(async () => {
    await openAgentTerminal('agent-2');
  });
  expect(screen.getByTestId('active-agent-terminal')).toHaveTextContent('agent-2');

  await act(async () => {
    await openAgentTerminal('agent-2');
  });
  expect(screen.getByTestId('active-agent-terminal')).toHaveTextContent('');
});

test('createAgent uses persisted sequence and avoids duplicate names', async () => {
  const originalLoadSettings = window.electronAPI.loadSettings;
  const originalSaveSettings = window.electronAPI.saveSettings;
  const originalSpawnAgent = window.electronAPI.spawnAgent;

  try {
    window.electronAPI.loadSettings = vi.fn(async () => ({
      agentNameSequencesByWorkspace: {
        '/workspace': { codex: 10 },
      },
    }));
    window.electronAPI.saveSettings = vi.fn(async () => true);
    const spawnAgent = vi.fn(async (payload) => ({
      success: true,
      agent: {
        id: 'agent-new',
        provider: payload.provider,
        model: payload.model ?? '',
        color: payload.color,
        name: payload.name,
        displayName: payload.displayName,
        workspacePath: payload.workspacePath,
        x: payload.x,
        y: payload.y,
        status: 'offline' as const,
        contextLeft: 100,
      },
    }));
    window.electronAPI.spawnAgent = spawnAgent;

    let createAgent: (provider: AgentProvider, x: number, y: number) => Promise<void> = async () => {};

    render(<CreateHarness initialAgents={[]} onReady={(create) => (createAgent = create)} />);

    await waitFor(() => {
      expect(window.electronAPI.loadSettings).toHaveBeenCalled();
    });

    await act(async () => {
      await createAgent('codex', 10, 20);
    });

    const payload = spawnAgent.mock.calls[0]?.[0];
    expect(payload?.displayName).toBe('Keira');
  } finally {
    window.electronAPI.loadSettings = originalLoadSettings;
    window.electronAPI.saveSettings = originalSaveSettings;
    window.electronAPI.spawnAgent = originalSpawnAgent;
  }
});

test('createAgent skips existing names when sequence collides', async () => {
  const originalLoadSettings = window.electronAPI.loadSettings;
  const originalSaveSettings = window.electronAPI.saveSettings;
  const originalSpawnAgent = window.electronAPI.spawnAgent;

  try {
    window.electronAPI.loadSettings = vi.fn(async () => ({
      agentNameSequencesByWorkspace: {
        '/workspace': { codex: 0 },
      },
    }));
    window.electronAPI.saveSettings = vi.fn(async () => true);
    const spawnAgent = vi.fn(async (payload) => ({
      success: true,
      agent: {
        id: 'agent-next',
        provider: payload.provider,
        model: payload.model ?? '',
        color: payload.color,
        name: payload.name,
        displayName: payload.displayName,
        workspacePath: payload.workspacePath,
        x: payload.x,
        y: payload.y,
        status: 'offline' as const,
        contextLeft: 100,
      },
    }));
    window.electronAPI.spawnAgent = spawnAgent;

    let createAgent: (provider: AgentProvider, x: number, y: number) => Promise<void> = async () => {};
    const existingAgents: Agent[] = [
      {
        id: 'agent-1',
        provider: 'codex',
        model: '',
        color: '#00ff00',
        name: 'Aiden',
        displayName: 'Aiden',
        workspacePath: '/workspace',
        x: 0,
        y: 0,
        status: 'online',
        attachedFolderId: 'folder-1',
        contextLeft: 75,
      },
    ];

    render(<CreateHarness initialAgents={existingAgents} onReady={(create) => (createAgent = create)} />);

    await waitFor(() => {
      expect(window.electronAPI.loadSettings).toHaveBeenCalled();
    });

    await act(async () => {
      await createAgent('codex', 10, 20);
    });

    const payload = spawnAgent.mock.calls[0]?.[0];
    expect(payload?.displayName).toBe('Bianca');
  } finally {
    window.electronAPI.loadSettings = originalLoadSettings;
    window.electronAPI.saveSettings = originalSaveSettings;
    window.electronAPI.spawnAgent = originalSpawnAgent;
  }
});

test('createAgent forwards attached folder ownership to spawn payload', async () => {
  const originalSpawnAgent = window.electronAPI.spawnAgent;

  try {
    const spawnAgent = vi.fn(async (payload) => ({
      success: true,
      agent: {
        id: 'agent-owned',
        provider: payload.provider,
        model: payload.model ?? '',
        color: payload.color,
        name: payload.name,
        displayName: payload.displayName,
        workspacePath: payload.workspacePath,
        x: payload.x,
        y: payload.y,
        status: 'online' as const,
        attachedFolderId: payload.attachedFolderId,
        contextLeft: 100,
      },
    }));
    window.electronAPI.spawnAgent = spawnAgent;

    let createAgent: (
      provider: AgentProvider,
      x: number,
      y: number,
      attachedFolderId?: string
    ) => Promise<void> = async () => {};

    render(<CreateHarness initialAgents={[]} onReady={(create) => (createAgent = create)} />);

    await act(async () => {
      await createAgent('claude', 50, 60, 'folder-123');
    });

    expect(spawnAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'claude',
        x: 50,
        y: 60,
        attachedFolderId: 'folder-123',
      })
    );
  } finally {
    window.electronAPI.spawnAgent = originalSpawnAgent;
  }
});

test('resetAgentNameSequenceIndex clears workspace sequence and restarts naming', async () => {
  const originalLoadSettings = window.electronAPI.loadSettings;
  const originalSaveSettings = window.electronAPI.saveSettings;
  const originalSpawnAgent = window.electronAPI.spawnAgent;

  try {
    window.electronAPI.loadSettings = vi.fn(async () => ({
      agentNameSequencesByWorkspace: {
        '/workspace': { claude: 24, codex: 9 },
        '/other': { claude: 3 },
      },
    }));
    const saveSettings = vi.fn(async () => true);
    window.electronAPI.saveSettings = saveSettings;
    const spawnAgent = vi.fn(async (payload) => ({
      success: true,
      agent: {
        id: 'agent-new',
        provider: payload.provider,
        model: payload.model ?? '',
        color: payload.color,
        name: payload.name,
        displayName: payload.displayName,
        workspacePath: payload.workspacePath,
        x: payload.x,
        y: payload.y,
        status: 'offline' as const,
        contextLeft: 100,
      },
    }));
    window.electronAPI.spawnAgent = spawnAgent;

    let controls: {
      create: (provider: AgentProvider, x: number, y: number) => Promise<void>;
      reset: () => Promise<CommandRunResult>;
    } | null = null;

    render(<NameSequenceHarness initialAgents={[]} onReady={(next) => (controls = next)} />);

    await waitFor(() => {
      expect(window.electronAPI.loadSettings).toHaveBeenCalled();
      expect(controls).not.toBeNull();
    });

    let resetResult!: CommandRunResult;
    await act(async () => {
      resetResult = await controls!.reset();
    });
    expect(resetResult.ok).toBe(true);

    const resetPayload = saveSettings.mock.calls
      .map((call) => (call as unknown[])[0])
      .filter(
        (payload): payload is { agentNameSequencesByWorkspace?: Record<string, unknown> } =>
          typeof payload === 'object' && payload !== null
      )
      .find((payload) => {
        const sequences = payload.agentNameSequencesByWorkspace;
        if (!sequences || typeof sequences !== 'object') return false;
        if ('/workspace' in sequences) return false;
        const other = sequences['/other'] as { claude?: unknown } | undefined;
        return other?.claude === 3;
      });
    expect(resetPayload).toBeTruthy();

    await act(async () => {
      await controls!.create('claude', 10, 20);
    });

    const payload = spawnAgent.mock.calls[0]?.[0];
    expect(payload?.displayName).toBe('Claude');
  } finally {
    window.electronAPI.loadSettings = originalLoadSettings;
    window.electronAPI.saveSettings = originalSaveSettings;
    window.electronAPI.spawnAgent = originalSpawnAgent;
  }
});

test('attachAgentToFolder resolves a free slot even when targetPos is occupied', async () => {
  const originalAgentAttachToFolder = window.electronAPI.agentAttachToFolder;
  const originalUpdateAgentPosition = window.electronAPI.updateAgentPosition;

  try {
    window.electronAPI.agentAttachToFolder = vi.fn(async () => ({ success: true }));
    window.electronAPI.updateAgentPosition = vi.fn(async () => true);

    const folder: Folder = {
      id: 'folder-1',
      name: 'Folder',
      relativePath: 'Folder',
      kind: 'folder',
      x: 100,
      y: 100,
      createdAt: Date.now(),
    };
    const occupiedPos = getAttachSlotPosition(folder, 0);
    const initialAgents: Agent[] = [
      {
        id: 'agent-1',
        provider: 'claude',
        model: '',
        color: '#ff0000',
        name: 'a1',
        displayName: 'a1',
        workspacePath: '/workspace',
        x: occupiedPos.x,
        y: occupiedPos.y,
        status: 'online',
        attachedFolderId: folder.id,
      },
      {
        id: 'agent-2',
        provider: 'codex',
        model: '',
        color: '#00ff00',
        name: 'a2',
        displayName: 'a2',
        workspacePath: '/workspace',
        x: 10,
        y: 20,
        status: 'offline',
      },
    ];

    let controls: {
      attach: (
        agentId: string,
        folderId: string,
        targetPos?: { x: number; y: number }
      ) => Promise<CommandRunResult>;
      getAgents: () => Agent[];
    } | null = null;

    render(
      <AttachHarness
        initialAgents={initialAgents}
        folders={[folder]}
        onReady={(next) => {
          controls = next;
        }}
      />
    );

    await waitFor(() => {
      expect(controls).not.toBeNull();
    });

    await act(async () => {
      await controls!.attach('agent-2', folder.id, occupiedPos);
    });

    await waitFor(() => {
      const agents = controls!.getAgents();
      const agent = agents.find((entry) => entry.id === 'agent-2');
      expect(agent?.attachedFolderId).toBe(folder.id);
      expect(agent?.x).not.toBe(occupiedPos.x);
      expect(agent?.y).not.toBe(occupiedPos.y);
    });
  } finally {
    window.electronAPI.agentAttachToFolder = originalAgentAttachToFolder;
    window.electronAPI.updateAgentPosition = originalUpdateAgentPosition;
  }
});

test('attachAgentToFolder keeps existing attached agents fixed when no extra space is needed', async () => {
  const originalAgentAttachToFolder = window.electronAPI.agentAttachToFolder;
  const originalUpdateAgentPosition = window.electronAPI.updateAgentPosition;

  try {
    window.electronAPI.agentAttachToFolder = vi.fn(async () => ({ success: true }));
    const updateAgentPosition = vi.fn(async (...args: [string, string, number, number]) => {
      void args;
      return true;
    });
    window.electronAPI.updateAgentPosition = updateAgentPosition;

    const folder: Folder = {
      id: 'folder-1',
      name: 'Folder',
      relativePath: 'Folder',
      kind: 'folder',
      x: 100,
      y: 100,
      createdAt: Date.now(),
    };
    const layout = layoutAttachedAgents(folder, [
      { id: 'agent-1', x: 180, y: 120 },
      { id: 'agent-2', x: 120, y: 180 },
    ]);

    const agent1Pos = layout.get('agent-1')?.position;
    const agent2Pos = layout.get('agent-2')?.position;
    if (!agent1Pos || !agent2Pos) {
      throw new Error('Expected layout positions for both agents');
    }

    const initialAgents: Agent[] = [
      {
        id: 'agent-1',
        provider: 'claude',
        model: '',
        color: '#ff0000',
        name: 'a1',
        displayName: 'a1',
        workspacePath: '/workspace',
        x: agent1Pos.x,
        y: agent1Pos.y,
        status: 'online',
        attachedFolderId: folder.id,
      },
      {
        id: 'agent-2',
        provider: 'codex',
        model: '',
        color: '#00ff00',
        name: 'a2',
        displayName: 'a2',
        workspacePath: '/workspace',
        x: agent2Pos.x,
        y: agent2Pos.y,
        status: 'online',
        attachedFolderId: folder.id,
      },
    ];

    let controls: {
      attach: (
        agentId: string,
        folderId: string,
        targetPos?: { x: number; y: number }
      ) => Promise<CommandRunResult>;
      getAgents: () => Agent[];
    } | null = null;

    render(
      <AttachHarness
        initialAgents={initialAgents}
        folders={[folder]}
        onReady={(next) => {
          controls = next;
        }}
      />
    );

    await waitFor(() => {
      expect(controls).not.toBeNull();
    });

    await act(async () => {
      await controls!.attach('agent-1', folder.id, agent1Pos);
    });

    await waitFor(() => {
      expect(updateAgentPosition).toHaveBeenCalledTimes(1);
      const persistedIds = updateAgentPosition.mock.calls.map((call) => call[1]);
      expect(persistedIds).toEqual(['agent-1']);

      const agents = controls!.getAgents();
      const attachedAgent2 = agents.find((entry) => entry.id === 'agent-2');
      expect(attachedAgent2?.x).toBe(agent2Pos.x);
      expect(attachedAgent2?.y).toBe(agent2Pos.y);
    });
  } finally {
    window.electronAPI.agentAttachToFolder = originalAgentAttachToFolder;
    window.electronAPI.updateAgentPosition = originalUpdateAgentPosition;
  }
});

test('reattaching one agent does not shift other attached agents when there is available space', async () => {
  const originalAgentAttachToFolder = window.electronAPI.agentAttachToFolder;
  const originalUpdateAgentPosition = window.electronAPI.updateAgentPosition;

  try {
    window.electronAPI.agentAttachToFolder = vi.fn(async () => ({ success: true }));
    const updateAgentPosition = vi.fn(async (...args: [string, string, number, number]) => {
      void args;
      return true;
    });
    window.electronAPI.updateAgentPosition = updateAgentPosition;

    const folder: Folder = {
      id: 'folder-1',
      name: 'Folder',
      relativePath: 'Folder',
      kind: 'folder',
      x: 100,
      y: 100,
      createdAt: Date.now(),
    };

    const attachedSeed = Array.from({ length: 5 }, (_, index) => ({
      id: `agent-${index + 1}`,
      x: 180 + index * 8,
      y: 120 + index * 8,
    }));
    const layout = layoutAttachedAgents(folder, attachedSeed);
    const fixedPositions = new Map<string, { x: number; y: number }>();
    const initialAgents: Agent[] = attachedSeed.map((entry) => {
      const slot = layout.get(entry.id);
      if (!slot) throw new Error(`Missing slot for ${entry.id}`);
      fixedPositions.set(entry.id, { x: slot.position.x, y: slot.position.y });
      return {
        id: entry.id,
        provider: 'claude',
        model: '',
        color: '#ff0000',
        name: entry.id,
        displayName: entry.id,
        workspacePath: '/workspace',
        x: slot.position.x,
        y: slot.position.y,
        status: 'online',
        attachedFolderId: folder.id,
      };
    });

    initialAgents.push({
      id: 'agent-6',
      provider: 'codex',
      model: '',
      color: '#00ff00',
      name: 'agent-6',
      displayName: 'agent-6',
      workspacePath: '/workspace',
      x: 500,
      y: 400,
      status: 'offline',
    });

    let controls: {
      attach: (
        agentId: string,
        folderId: string,
        targetPos?: { x: number; y: number }
      ) => Promise<CommandRunResult>;
      getAgents: () => Agent[];
    } | null = null;

    render(
      <AttachHarness
        initialAgents={initialAgents}
        folders={[folder]}
        onReady={(next) => {
          controls = next;
        }}
      />
    );

    await waitFor(() => {
      expect(controls).not.toBeNull();
    });

    await act(async () => {
      await controls!.attach('agent-6', folder.id, { x: 500, y: 400 });
    });

    await waitFor(() => {
      expect(updateAgentPosition).toHaveBeenCalledTimes(1);
      expect(updateAgentPosition.mock.calls[0]?.[1]).toBe('agent-6');

      const agents = controls!.getAgents();
      fixedPositions.forEach((position, id) => {
        const agent = agents.find((entry) => entry.id === id);
        expect(agent?.x).toBe(position.x);
        expect(agent?.y).toBe(position.y);
      });
    });
  } finally {
    window.electronAPI.agentAttachToFolder = originalAgentAttachToFolder;
    window.electronAPI.updateAgentPosition = originalUpdateAgentPosition;
  }
});

test('attachAgentToFolder rolls back when persisting shifted agents fails', async () => {
  const originalAgentAttachToFolder = window.electronAPI.agentAttachToFolder;
  const originalUpdateAgentPosition = window.electronAPI.updateAgentPosition;

  try {
    const agentAttachToFolder = vi.fn(async () => ({ success: true }));
    window.electronAPI.agentAttachToFolder = agentAttachToFolder;
    const updateAgentPosition = vi.fn(async (...args: [string, string, number, number]) => {
      const [, agentId] = args;
      if (agentId === 'agent-2') {
        return false;
      }
      return true;
    });
    window.electronAPI.updateAgentPosition = updateAgentPosition;

    const folder: Folder = {
      id: 'folder-1',
      name: 'Folder',
      relativePath: 'Folder',
      kind: 'folder',
      x: 100,
      y: 100,
      createdAt: Date.now(),
    };

    const initialAgents: Agent[] = [
      {
        id: 'agent-1',
        provider: 'claude',
        model: '',
        color: '#ff0000',
        name: 'a1',
        displayName: 'a1',
        workspacePath: '/workspace',
        x: 140,
        y: 116,
        status: 'online',
        attachedFolderId: folder.id,
      },
      {
        id: 'agent-2',
        provider: 'codex',
        model: '',
        color: '#00ff00',
        name: 'a2',
        displayName: 'a2',
        workspacePath: '/workspace',
        x: 140,
        y: 116,
        status: 'online',
        attachedFolderId: folder.id,
      },
      {
        id: 'agent-3',
        provider: 'claude',
        model: '',
        color: '#0000ff',
        name: 'a3',
        displayName: 'a3',
        workspacePath: '/workspace',
        x: 360,
        y: 320,
        status: 'offline',
      },
    ];

    let controls: {
      attach: (
        agentId: string,
        folderId: string,
        targetPos?: { x: number; y: number }
      ) => Promise<CommandRunResult>;
      getAgents: () => Agent[];
    } | null = null;

    render(
      <AttachHarness
        initialAgents={initialAgents}
        folders={[folder]}
        onReady={(next) => {
          controls = next;
        }}
      />
    );

    await waitFor(() => {
      expect(controls).not.toBeNull();
    });

    let result!: CommandRunResult;
    await act(async () => {
      result = await controls!.attach('agent-3', folder.id, { x: 140, y: 116 });
    });

    expect(result.ok).toBe(false);
    expect(agentAttachToFolder).not.toHaveBeenCalled();

    await waitFor(() => {
      const agents = controls!.getAgents();
      const agent1 = agents.find((entry) => entry.id === 'agent-1');
      const agent2 = agents.find((entry) => entry.id === 'agent-2');
      const agent3 = agents.find((entry) => entry.id === 'agent-3');

      expect(agent1?.x).toBe(140);
      expect(agent1?.y).toBe(116);
      expect(agent1?.attachedFolderId).toBe(folder.id);

      expect(agent2?.x).toBe(140);
      expect(agent2?.y).toBe(116);
      expect(agent2?.attachedFolderId).toBe(folder.id);

      expect(agent3?.x).toBe(360);
      expect(agent3?.y).toBe(320);
      expect(agent3?.attachedFolderId).toBeUndefined();
      expect(agent3?.status).toBe('offline');
    });
  } finally {
    window.electronAPI.agentAttachToFolder = originalAgentAttachToFolder;
    window.electronAPI.updateAgentPosition = originalUpdateAgentPosition;
  }
});
