import * as Blockly from "blockly";

type ResourceKind = "whole-port" | "port-pin" | "location";
type ResourceDefinition = {
  kind: ResourceKind;
  portField?: string;
  pinField?: string;
  locationField?: string;
  shareRepeatedActuator?: boolean;
};
type FieldValues = Record<string, string>;

export const PORT_OPTIONS: [string, string][] = [
  ["1", "1"], ["2", "2"], ["3", "3"], ["4", "4"], ["5", "5"], ["6", "6"],
];
export const PIN_OPTIONS: [string, string][] = [["A", "A"], ["B", "B"]];
export const SENSOR_LOCATION_OPTIONS: [string, string][] = [
  ["Port 1 A (GPIO8)", "1A"],
  ["Port 1 B (GPIO7)", "1B"],
  ["Port 2 A (GPIO9)", "2A"],
  ["Port 3 A (GPIO10)", "3A"],
  ["Port 4 A (GPIO4)", "4A"],
  ["Port 5 A (GPIO5)", "5A"],
  ["Port 6 A (GPIO6)", "6A"],
];

const HARDWARE_RESOURCES: Record<string, ResourceDefinition> = {
  sensor_ultrasonic: { kind: "whole-port", portField: "PORT" },
  sensor_ir: { kind: "port-pin", portField: "PORT", pinField: "PIN" },
  sensor_dht11: { kind: "port-pin", portField: "PORT", pinField: "PIN" },
  sensor_digital: { kind: "port-pin", portField: "PORT", pinField: "PIN" },
  sensor_ldr: { kind: "location", locationField: "LOC" },
  sensor_soil: { kind: "location", locationField: "LOC" },
  sensor_gas: { kind: "location", locationField: "LOC" },
  sensor_analog: { kind: "location", locationField: "LOC" },
  // Repeated commands may address the same physical actuator (for example,
  // turning one LED on and later off in a loop). Different device types still
  // cannot claim the same pin.
  led_out: { kind: "port-pin", portField: "PORT", pinField: "PIN", shareRepeatedActuator: true },
  servo_angle: { kind: "port-pin", portField: "PORT", pinField: "PIN", shareRepeatedActuator: true },
};

const UNAVAILABLE_PORT: [string, string] = ["No compatible port available", ""];
const UNAVAILABLE_PIN: [string, string] = ["No compatible pin available", ""];
const UNAVAILABLE_LOCATION: [string, string] = ["No compatible input available", ""];

function resourceKeys(block: Blockly.Block): string[] {
  const definition = HARDWARE_RESOURCES[block.type];
  if (!definition) return [];

  if (definition.kind === "location") {
    const location = block.getFieldValue(definition.locationField!);
    return SENSOR_LOCATION_OPTIONS.some(([, value]) => value === location) ? [location] : [];
  }

  const port = block.getFieldValue(definition.portField!);
  if (!PORT_OPTIONS.some(([, value]) => value === port)) return [];
  if (definition.kind === "whole-port") return [`${port}A`, `${port}B`];

  const pin = block.getFieldValue(definition.pinField!);
  return PIN_OPTIONS.some(([, value]) => value === pin) ? [`${port}${pin}`] : [];
}

type Occupancy = Map<string, Set<string>>;

function canUse(keys: string[], blockType: string, occupancy: Occupancy): boolean {
  const definition = HARDWARE_RESOURCES[blockType];
  return keys.every((key) => {
    const owners = occupancy.get(key);
    if (!owners?.size) return true;
    return !!definition?.shareRepeatedActuator && [...owners].every((owner) => owner === blockType);
  });
}

function reserve(keys: string[], blockType: string, occupancy: Occupancy) {
  for (const key of keys) {
    const owners = occupancy.get(key) ?? new Set<string>();
    owners.add(blockType);
    occupancy.set(key, owners);
  }
}

function occupiedByOthers(workspace: Blockly.Workspace, block: Blockly.Block): Occupancy {
  const occupancy: Occupancy = new Map();
  for (const other of workspace.getAllBlocks(false)) {
    if (other.id === block.id || !HARDWARE_RESOURCES[other.type]) continue;
    reserve(resourceKeys(other), other.type, occupancy);
  }
  return occupancy;
}

function dynamicOptions(block: Blockly.Block, fieldName: string): [string, string][] {
  const definition = HARDWARE_RESOURCES[block.type];
  if (!definition) return [];
  const occupancy = occupiedByOthers(block.workspace, block);

  if (fieldName === definition.locationField) {
    const options = SENSOR_LOCATION_OPTIONS.filter(([, value]) => canUse([value], block.type, occupancy));
    return options.length ? options : [UNAVAILABLE_LOCATION];
  }

  if (fieldName === definition.portField) {
    const options = PORT_OPTIONS.filter(([, port]) => {
      const candidateKeys = definition.kind === "whole-port"
        ? [`${port}A`, `${port}B`]
        : PIN_OPTIONS.map(([, pin]) => `${port}${pin}`);
      return candidateKeys.some((key) => canUse([key], block.type, occupancy)) &&
        (definition.kind !== "whole-port" || canUse(candidateKeys, block.type, occupancy));
    });
    return options.length ? options : [UNAVAILABLE_PORT];
  }

  if (fieldName === definition.pinField) {
    const port = block.getFieldValue(definition.portField!);
    const options = PIN_OPTIONS.filter(([, pin]) => canUse([`${port}${pin}`], block.type, occupancy));
    return options.length ? options : [UNAVAILABLE_PIN];
  }

  return [];
}

/** Install live, centralized dropdown menus on every shared-port block. */
export function installHardwareDropdowns() {
  for (const [blockType, definition] of Object.entries(HARDWARE_RESOURCES)) {
    type MutableBlockDefinition = { init: (this: Blockly.Block) => void; hardwareMenusInstalled?: boolean };
    const blockDefinition = Blockly.Blocks[blockType] as unknown as MutableBlockDefinition | undefined;
    if (!blockDefinition || blockDefinition.hardwareMenusInstalled) continue;
    const originalInit = blockDefinition.init;
    blockDefinition.init = function (this: Blockly.Block) {
      originalInit.call(this);
      const fieldNames = [definition.portField, definition.pinField, definition.locationField].filter(Boolean) as string[];
      for (const fieldName of fieldNames) {
        const field = this.getField(fieldName) as Blockly.FieldDropdown | null;
        field?.setOptions(function (this: Blockly.FieldDropdown) {
          const source = this.getSourceBlock();
          return source ? dynamicOptions(source, fieldName) : [];
        });
      }
    };
    blockDefinition.hardwareMenusInstalled = true;
  }
}

function suggestedAssignment(block: Blockly.Block, occupancy: Occupancy): FieldValues | null {
  const definition = HARDWARE_RESOURCES[block.type];
  if (!definition) return null;
  const current = (field: string) => block.getFieldValue(field) ?? "";

  if (definition.kind === "location") {
    const options = [...SENSOR_LOCATION_OPTIONS].sort((a, b) =>
      Number(b[1] === current(definition.locationField!)) - Number(a[1] === current(definition.locationField!)));
    const choice = options.find(([, value]) => canUse([value], block.type, occupancy));
    return choice ? { [definition.locationField!]: choice[1] } : null;
  }

  if (definition.kind === "whole-port") {
    const options = [...PORT_OPTIONS].sort(([, a], [, b]) =>
      Number(b === current(definition.portField!)) - Number(a === current(definition.portField!)));
    const choice = options.find(([, port]) => canUse([`${port}A`, `${port}B`], block.type, occupancy));
    return choice ? { [definition.portField!]: choice[1] } : null;
  }

  const ports = [...PORT_OPTIONS].sort(([, a], [, b]) =>
    Number(b === current(definition.portField!)) - Number(a === current(definition.portField!)));
  const pins = [...PIN_OPTIONS].sort(([, a], [, b]) =>
    Number(b === current(definition.pinField!)) - Number(a === current(definition.pinField!)));
  for (const [, port] of ports) {
    for (const [, pin] of pins) {
      if (canUse([`${port}${pin}`], block.type, occupancy)) {
        return { [definition.portField!]: port, [definition.pinField!]: pin };
      }
    }
  }
  return null;
}

/** Resolve duplicate/invalid assignments after create, duplicate, field edit or delete. */
export function reconcileHardwareResources(workspace: Blockly.WorkspaceSvg) {
  const occupancy: Occupancy = new Map();
  let changed = false;
  Blockly.Events.disable();
  try {
    for (const block of workspace.getAllBlocks(false)) {
      if (!HARDWARE_RESOURCES[block.type]) continue;
      const keys = resourceKeys(block);
      if (!keys.length || !canUse(keys, block.type, occupancy)) {
        const assignment = suggestedAssignment(block, occupancy);
        const definition = HARDWARE_RESOURCES[block.type];
        const fields = assignment ?? (definition.kind === "location"
          ? { [definition.locationField!]: "" }
          : definition.kind === "whole-port"
            ? { [definition.portField!]: "" }
            : { [definition.portField!]: "", [definition.pinField!]: "" });
        for (const [name, value] of Object.entries(fields)) {
          if (block.getFieldValue(name) !== value) {
            block.setFieldValue(value, name);
            changed = true;
          }
        }
      }
      const resolvedKeys = resourceKeys(block);
      if (resolvedKeys.length && canUse(resolvedKeys, block.type, occupancy)) reserve(resolvedKeys, block.type, occupancy);
    }
  } finally {
    Blockly.Events.enable();
  }
  return changed;
}

const BLOCK_LABELS: Record<string, string> = {
  sensor_ultrasonic: "Ultrasonic sensor", sensor_ir: "IR sensor", sensor_dht11: "DHT11 sensor",
  sensor_digital: "Digital sensor", sensor_ldr: "LDR sensor", sensor_soil: "Soil sensor",
  sensor_gas: "Gas sensor", sensor_analog: "Analog sensor", led_out: "LED output", servo_angle: "Servo",
};

/** Return actionable missing-resource and port-conflict messages for Verify. */
export function validateHardwareResources(workspace: Blockly.WorkspaceSvg): string[] {
  const errors: string[] = [];
  const owners = new Map<string, Blockly.Block[]>();

  for (const block of workspace.getAllBlocks(false)) {
    const definition = HARDWARE_RESOURCES[block.type];
    if (!definition) continue;
    const keys = resourceKeys(block);
    if (!keys.length) {
      errors.push(`${BLOCK_LABELS[block.type]} needs an available port and pin selection.`);
      continue;
    }
    for (const key of keys) {
      const existing = owners.get(key) ?? [];
      const sharingAllowed = definition.shareRepeatedActuator && existing.every((owner) => owner.type === block.type);
      if (existing.length && !sharingAllowed) {
        const other = existing[0];
        errors.push(`${key} is assigned to both ${BLOCK_LABELS[other.type]} and ${BLOCK_LABELS[block.type]}. Choose a different port or pin.`);
      }
      existing.push(block);
      owners.set(key, existing);
    }
  }
  return [...new Set(errors)];
}

export function isHardwareResourceBlock(blockType: string) {
  return blockType in HARDWARE_RESOURCES;
}
