import { useState } from "react";

// Tracks whether each of the app's overlay/inline panels is open. These are
// independent booleans (not a single "active panel" enum) because that's how
// the app already behaved before this was extracted — nothing here changes
// visibility rules, it just gives the five useState calls one home.
export interface PanelState {
  history: boolean;
  glossary: boolean;
  collaboration: boolean;
  projectSettings: boolean;
  exportSummary: boolean;
}

const initialPanelState: PanelState = {
  history: false,
  glossary: false,
  collaboration: false,
  projectSettings: false,
  exportSummary: false,
};

export function usePanels() {
  const [panels, setPanels] = useState<PanelState>(initialPanelState);

  function openPanel(name: keyof PanelState) {
    setPanels((prev) => ({ ...prev, [name]: true }));
  }

  function closePanel(name: keyof PanelState) {
    setPanels((prev) => ({ ...prev, [name]: false }));
  }

  return { panels, openPanel, closePanel };
}