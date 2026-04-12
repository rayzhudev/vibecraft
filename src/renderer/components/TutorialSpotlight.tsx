import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useState } from 'react';

type SpotlightRect = {
  top: number;
  left: number;
  width: number;
  height: number;
};

interface TutorialSpotlightProps {
  active: boolean;
  targetSelector?: string | string[] | null;
  outlineSelector?: string | string[] | null;
  padding?: number;
  zIndex?: number;
  outlineEnabled?: boolean;
  maskEnabled?: boolean;
  combineTargets?: boolean;
}

const DEFAULT_PADDING = 12;
const DEFAULT_Z_INDEX = 8000;

const clampRect = (rect: SpotlightRect): SpotlightRect => ({
  top: Math.max(0, rect.top),
  left: Math.max(0, rect.left),
  width: Math.max(0, rect.width),
  height: Math.max(0, rect.height),
});

const normalizeSelectors = (value?: string | string[] | null): string[] => {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value.filter((selector) => typeof selector === 'string' && selector.length > 0);
  }
  return value.length > 0 ? [value] : [];
};

const rectsEqual = (a: SpotlightRect[], b: SpotlightRect[]): boolean => {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    const left = a[i];
    const right = b[i];
    if (
      left.top !== right.top ||
      left.left !== right.left ||
      left.width !== right.width ||
      left.height !== right.height
    ) {
      return false;
    }
  }
  return true;
};

export default function TutorialSpotlight({
  active,
  targetSelector,
  outlineSelector,
  padding = DEFAULT_PADDING,
  zIndex = DEFAULT_Z_INDEX,
  outlineEnabled = true,
  maskEnabled = true,
  combineTargets = false,
}: TutorialSpotlightProps) {
  const [maskRects, setMaskRects] = useState<SpotlightRect[]>([]);
  const [outlineRects, setOutlineRects] = useState<SpotlightRect[]>([]);
  const maskId = useId();

  const selectorList = useMemo(() => normalizeSelectors(targetSelector), [targetSelector]);
  const outlineSelectorList = useMemo(() => normalizeSelectors(outlineSelector), [outlineSelector]);

  const combineRectList = useCallback(
    (rects: SpotlightRect[]): SpotlightRect[] => {
      if (!combineTargets || rects.length <= 1) {
        return rects;
      }
      const minLeft = Math.min(...rects.map((rect) => rect.left));
      const minTop = Math.min(...rects.map((rect) => rect.top));
      const maxRight = Math.max(...rects.map((rect) => rect.left + rect.width));
      const maxBottom = Math.max(...rects.map((rect) => rect.top + rect.height));
      return [
        clampRect({
          left: minLeft,
          top: minTop,
          width: maxRight - minLeft,
          height: maxBottom - minTop,
        }),
      ];
    },
    [combineTargets]
  );

  const getElementRect = useCallback(
    (element: HTMLElement): SpotlightRect | null => {
      const baseBox = element.getBoundingClientRect();
      const boxes: DOMRect[] = [];
      if (baseBox.width > 0 && baseBox.height > 0) {
        boxes.push(baseBox);
      }
      const labelElements = Array.from(
        element.querySelectorAll<HTMLElement>('.folder-label, .unit-overhead, .unit-nameplate')
      );
      for (const label of labelElements) {
        const box = label.getBoundingClientRect();
        if (box.width > 0 && box.height > 0) {
          boxes.push(box);
        }
      }
      if (boxes.length === 0) return null;
      const minLeft = Math.min(...boxes.map((box) => box.left));
      const minTop = Math.min(...boxes.map((box) => box.top));
      const maxRight = Math.max(...boxes.map((box) => box.left + box.width));
      const maxBottom = Math.max(...boxes.map((box) => box.top + box.height));
      return clampRect({
        top: minTop - padding,
        left: minLeft - padding,
        width: maxRight - minLeft + padding * 2,
        height: maxBottom - minTop + padding * 2,
      });
    },
    [padding]
  );

  useLayoutEffect(() => {
    if (!active || selectorList.length === 0) {
      setMaskRects((prev) => (prev.length === 0 ? prev : []));
      setOutlineRects((prev) => (prev.length === 0 ? prev : []));
      return;
    }

    let frame: number | null = null;
    const queryElements = (selectors: string[]) =>
      selectors.flatMap((selector) => Array.from(document.querySelectorAll(selector)) as HTMLElement[]);
    const buildRects = (elements: HTMLElement[]) => {
      const rects = elements
        .map((element) => getElementRect(element))
        .filter((rect): rect is SpotlightRect => Boolean(rect));
      return combineRectList(rects);
    };
    const updateRects = () => {
      const maskElements = queryElements(selectorList);
      const outlineElements =
        outlineSelectorList.length > 0 ? queryElements(outlineSelectorList) : maskElements;
      const nextMaskRects = buildRects(maskElements);
      const nextOutlineRects = outlineEnabled ? buildRects(outlineElements) : [];
      setMaskRects((prev) => (rectsEqual(prev, nextMaskRects) ? prev : nextMaskRects));
      setOutlineRects((prev) => (rectsEqual(prev, nextOutlineRects) ? prev : nextOutlineRects));
    };
    const scheduleUpdate = () => {
      if (frame !== null) return;
      frame = window.requestAnimationFrame(() => {
        frame = null;
        updateRects();
      });
    };

    scheduleUpdate();

    const handleWindowChange = () => scheduleUpdate();
    window.addEventListener('resize', handleWindowChange);
    window.addEventListener('scroll', handleWindowChange, true);

    return () => {
      window.removeEventListener('resize', handleWindowChange);
      window.removeEventListener('scroll', handleWindowChange, true);
      if (frame !== null) {
        window.cancelAnimationFrame(frame);
      }
    };
  }, [active, combineRectList, getElementRect, outlineEnabled, outlineSelectorList, selectorList]);

  useEffect(() => {
    if (!active || selectorList.length === 0) return;
    let frame: number | null = null;
    const scheduleUpdate = () => {
      if (frame !== null) return;
      frame = window.requestAnimationFrame(() => {
        frame = null;
        const elements = selectorList.flatMap(
          (selector: string) => Array.from(document.querySelectorAll(selector)) as HTMLElement[]
        );
        const nextMaskRects = combineRectList(
          elements
            .map((element: HTMLElement) => getElementRect(element))
            .filter((rect): rect is SpotlightRect => Boolean(rect))
        );
        const nextOutlineRects = outlineEnabled
          ? combineRectList(
              (outlineSelectorList.length > 0 ? outlineSelectorList : selectorList)
                .flatMap(
                  (selector: string) => Array.from(document.querySelectorAll(selector)) as HTMLElement[]
                )
                .map((element: HTMLElement) => getElementRect(element))
                .filter((rect): rect is SpotlightRect => Boolean(rect))
            )
          : [];
        setMaskRects((prev) => (rectsEqual(prev, nextMaskRects) ? prev : nextMaskRects));
        setOutlineRects((prev) => (rectsEqual(prev, nextOutlineRects) ? prev : nextOutlineRects));
      });
    };
    const observer = new MutationObserver(() => {
      scheduleUpdate();
    });
    observer.observe(document.body, { attributes: true, childList: true, subtree: true });
    return () => {
      observer.disconnect();
      if (frame !== null) {
        window.cancelAnimationFrame(frame);
      }
    };
  }, [active, combineRectList, getElementRect, outlineEnabled, outlineSelectorList, selectorList]);

  if (!active) return null;

  const styleVars = { ['--tutorial-spotlight-z' as string]: zIndex };

  const spotlightClassName = maskEnabled
    ? 'tutorial-spotlight'
    : 'tutorial-spotlight tutorial-spotlight--outline-only';

  return (
    <div className={spotlightClassName} style={styleVars}>
      <svg className="tutorial-spotlight-svg" width="100%" height="100%" aria-hidden="true">
        {maskEnabled && (
          <>
            <defs>
              <mask id={maskId}>
                <rect width="100%" height="100%" fill="white" />
                {maskRects.map((rect) => (
                  <rect
                    key={`${rect.top}-${rect.left}-${rect.width}-${rect.height}`}
                    x={rect.left}
                    y={rect.top}
                    width={rect.width}
                    height={rect.height}
                    rx={12}
                    ry={12}
                    fill="black"
                  />
                ))}
              </mask>
            </defs>
            <rect width="100%" height="100%" fill="rgba(0, 0, 0, 0.6)" mask={`url(#${maskId})`} />
          </>
        )}
        {outlineRects.map((rect) => (
          <rect
            key={`outline-${rect.top}-${rect.left}-${rect.width}-${rect.height}`}
            x={rect.left}
            y={rect.top}
            width={rect.width}
            height={rect.height}
            rx={12}
            ry={12}
            fill="none"
            stroke="rgba(250, 204, 21, 0.95)"
            strokeWidth={2}
          />
        ))}
      </svg>
    </div>
  );
}
