import { Fragment, useCallback, useEffect, useState } from 'react';
import type { AbilityDescriptor, AbilityVariant } from './abilityBuilder';
import type { CommandInvocation } from '../../commands/registry';
import {
  getAbilityHotkeyLabel,
  setVariantSelection,
  resolveEffectiveCommandId,
  type HotkeyMode,
} from './hotkeys';
import { useAppSettings } from '../../state/appSettingsStore';
import { isDeleteAbilityId } from './abilityUtils';

const isIconUrl = (icon: string): boolean =>
  icon.startsWith('/') || icon.startsWith('data:') || icon.endsWith('.svg');

const renderIcon = (icon: string | undefined, className: string) => {
  if (!icon) return null;
  if (isIconUrl(icon)) {
    return <img className={className} src={icon} alt="" />;
  }
  return <span className={className}>{icon}</span>;
};

interface ActionBarProps {
  abilities: AbilityDescriptor[];
  hotkeyMode?: HotkeyMode;
  onAbility: (ability: CommandInvocation) => void;
  triggerPress?: { index: number; key: number } | null;
}

export default function ActionBar({
  abilities,
  hotkeyMode = 'numbers',
  onAbility,
  triggerPress,
}: ActionBarProps) {
  const [pressedIndex, setPressedIndex] = useState<number | null>(null);

  useEffect(() => {
    if (triggerPress) {
      setPressedIndex(triggerPress.index);
      const timer = setTimeout(() => setPressedIndex(null), 200);
      return () => clearTimeout(timer);
    }
  }, [triggerPress]);

  const [openDropdown, setOpenDropdown] = useState<number | null>(null);
  const { settings } = useAppSettings();
  const variantSelections = (settings.uiState?.abilityVariantSelections ?? {}) as Record<string, string>;

  useEffect(() => {
    const handleClickOutside = () => setOpenDropdown(null);
    if (openDropdown !== null) {
      document.addEventListener('click', handleClickOutside);
      return () => document.removeEventListener('click', handleClickOutside);
    }
  }, [openDropdown]);

  const getSelectedVariant = (ability: AbilityDescriptor): AbilityVariant | null => {
    if (!ability.variants || ability.variants.length === 0) return null;
    const selectedId = variantSelections[ability.id];
    return ability.variants.find((v) => v.id === selectedId) ?? ability.variants[0];
  };

  const handleAbilityClick = (index: number) => {
    const ability = abilities[index];
    if (ability && !ability.disabled) {
      setPressedIndex(index);
      setTimeout(() => setPressedIndex(null), 200);
      const command = resolveEffectiveCommandId(ability, variantSelections);
      onAbility(command);
    }
  };

  const handleVariantSelect = useCallback((ability: AbilityDescriptor, variant: AbilityVariant) => {
    setVariantSelection(ability.id, variant.id);
    setOpenDropdown(null);
  }, []);

  const handleDropdownToggle = useCallback((e: React.MouseEvent, index: number) => {
    e.stopPropagation();
    setOpenDropdown((prev) => (prev === index ? null : index));
  }, []);

  if (abilities.length === 0) {
    return null;
  }

  const MAX_PER_ROW = 7;
  const rows: AbilityDescriptor[][] = [];
  for (let i = 0; i < abilities.length; i += MAX_PER_ROW) {
    rows.push(abilities.slice(i, i + MAX_PER_ROW));
  }

  return (
    <div className="action-bar">
      {rows.map((row, rowIndex) => (
        <div key={rowIndex} className="action-bar-row">
          {row.map((ability, indexInRow) => {
            const globalIndex = rowIndex * MAX_PER_ROW + indexInRow;
            const hotkeyLabel = getAbilityHotkeyLabel(ability, globalIndex, hotkeyMode, abilities);
            const hasVariants = ability.variants && ability.variants.length > 1;
            const selectedVariant = getSelectedVariant(ability);
            const displayIcon = selectedVariant?.icon ?? ability.icon;
            const tooltipText =
              ability.tooltip ??
              (selectedVariant ? `${ability.label} (${selectedVariant.label})` : ability.label);
            const isDropdownOpen = openDropdown === globalIndex;
            const showDivider = isDeleteAbilityId(ability.id) && globalIndex > 0;

            if (hasVariants) {
              return (
                <Fragment key={`${ability.id}-${globalIndex}`}>
                  {showDivider && <div className="action-bar-divider" aria-hidden="true" />}
                  <div className="action-bar-btn-wrapper">
                    <button
                      className={`action-bar-btn has-variants ${
                        ability.kind === 'warning' ? 'warning' : ''
                      } ${ability.selected ? 'selected' : ''} ${pressedIndex === globalIndex ? 'pressed' : ''}`}
                      onClick={() => handleAbilityClick(globalIndex)}
                      disabled={ability.disabled}
                      data-testid={`action-${ability.id}`}
                      data-tutorial-target={`ability-${ability.id}`}
                    >
                      {hotkeyLabel && <span className="action-bar-hotkey">{hotkeyLabel}</span>}
                      {renderIcon(displayIcon, 'action-bar-icon')}
                      <span className="action-bar-tooltip">
                        {tooltipText}
                        {hotkeyLabel && <span className="action-bar-tooltip-key">{hotkeyLabel}</span>}
                      </span>
                    </button>
                    <button
                      className={`action-bar-dropdown-arrow ${isDropdownOpen ? 'open' : ''}`}
                      onClick={(e) => handleDropdownToggle(e, globalIndex)}
                      aria-label="Select variant"
                    >
                      <svg viewBox="0 0 10 6" aria-hidden="true">
                        <path
                          d="M1 1l4 4 4-4"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    </button>
                    {isDropdownOpen && (
                      <div className="action-bar-dropdown-menu" onClick={(e) => e.stopPropagation()}>
                        {ability.variants!.map((variant) => (
                          <button
                            key={variant.id}
                            className={`action-bar-dropdown-item ${selectedVariant?.id === variant.id ? 'selected' : ''}`}
                            data-testid={`action-variant-${variant.id}`}
                            onClick={() => handleVariantSelect(ability, variant)}
                          >
                            {renderIcon(variant.icon, 'action-bar-dropdown-icon')}
                            <span className="action-bar-dropdown-label">{variant.label}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </Fragment>
              );
            }

            return (
              <Fragment key={`${ability.id}-${globalIndex}`}>
                {showDivider && <div className="action-bar-divider" aria-hidden="true" />}
                <button
                  className={`action-bar-btn ${
                    ability.kind === 'warning' ? 'warning' : ''
                  } ${ability.selected ? 'selected' : ''} ${pressedIndex === globalIndex ? 'pressed' : ''}`}
                  onClick={() => handleAbilityClick(globalIndex)}
                  disabled={ability.disabled}
                  data-testid={`action-${ability.id}`}
                  data-tutorial-target={`ability-${ability.id}`}
                >
                  {hotkeyLabel && <span className="action-bar-hotkey">{hotkeyLabel}</span>}
                  {renderIcon(ability.icon, 'action-bar-icon')}
                  <span className="action-bar-tooltip">
                    {tooltipText}
                    {hotkeyLabel && <span className="action-bar-tooltip-key">{hotkeyLabel}</span>}
                  </span>
                </button>
              </Fragment>
            );
          })}
        </div>
      ))}
    </div>
  );
}
