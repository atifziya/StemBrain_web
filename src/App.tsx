import { useEffect, useRef, useState } from "react";
import * as Blockly from "blockly";
import { auth, db } from "./firebase";
import { signInAnonymously, onAuthStateChanged } from "firebase/auth";
import { ref, get, set, onValue, off } from "firebase/database";
import BleTerminal from "./BleTerminal";
import logoUrl from "./assets/logo.png";
import {
  installHardwareDropdowns,
  PORT_OPTIONS,
  PIN_OPTIONS,
  reconcileHardwareResources,
  SENSOR_LOCATION_OPTIONS,
  validateHardwareResources,
} from "./hardwareResources";

/* ==================== M10.14: Save/Load + Examples ==================== */

const PROJECT_KEY = "stembrain_web_ide_project_name_v1";

/* ---- Block builders for example programs ---- */

const chain = (blocks: any[]): any => {
  if (blocks.length === 0) return null;
  const [head, ...rest] = blocks;
  const copy = { ...head };
  if (rest.length > 0) copy.next = { block: chain(rest) };
  return copy;
};

const num = (v: number) => ({ type: "math_number", fields: { NUM: v } });
const ledB = (mode: "on" | "off") => ({
  type: "led_out", fields: { PORT: "1", PIN: "A", MODE: mode },
});
const waitB = (ms: number) => ({
  type: "delay_ms",
  inputs: { MS: { block: num(ms) } },
});
const motorB = (m: number, dir: string) => ({
  type: "motor_control", fields: { MOTOR: String(m), DIR: dir },
});
const buzzerB = (mode: "on" | "off") => ({
  type: "buzzer_simple", fields: { MODE: mode },
});
const usB = (port: number) => ({
  type: "sensor_ultrasonic", fields: { PORT: String(port) },
});
const ldrB = (loc: string) => ({ type: "sensor_ldr", fields: { LOC: loc } });
const irB = (port: number, pin: string) => ({
  type: "sensor_ir", fields: { PORT: String(port), PIN: pin },
});
const dhtB = (field: string, port: number, pin: string) => ({
  type: "sensor_dht11", fields: { FIELD: field, PORT: String(port), PIN: pin },
});
const servoB = (port: number, pin: string, angle: number) => ({
  type: "servo_angle", fields: { PORT: String(port), PIN: pin, ANGLE: angle },
});
const bleSendB = (text: string) => ({
  type: "ble_send_text", fields: { TEXT: text },
});
const bleRecvB = () => ({ type: "ble_recv" });
const printValueB = (value: any) => ({
  type: "print_num", inputs: { VAL: { block: value } },
});

const cmpB = (op: string, a: any, b: any) => ({
  type: "logic_compare",
  fields: { OP: op },
  inputs: { A: { block: a }, B: { block: b } },
});

/* M10.14-fix: controls_if with else uses `extraState.hasElse` */
const ifB = (cond: any, thenBlocks: any[], elseBlocks?: any[]) => {
  const hasElse = !!(elseBlocks && elseBlocks.length > 0);
  const inputs: any = {
    IF0: { block: cond },
    DO0: { block: chain(thenBlocks) },
  };
  if (hasElse) {
    inputs.ELSE = { block: chain(elseBlocks!) };
  }
  return {
    type: "controls_if",
    extraState: { hasElse },
    inputs,
  };
};

const foreverB = (firstBlock: any) => ({
  blocks: {
    languageVersion: 0,
    blocks: [{
      type: "forever",
      x: 40, y: 40,
      inputs: { DO: { block: firstBlock } },
    }],
  },
});

const EXAMPLES: { id: string; name: string; ws: any; description?: string }[] = [
  {
    id: "led-blink",
    name: "1. LED Blink (500ms)",
    ws: foreverB(chain([ledB("on"), waitB(500), ledB("off"), waitB(500)])),
  },
  {
    id: "motor-test",
    name: "2. Motor Test (Fwd/Back)",
    ws: foreverB(chain([
      motorB(1, "fwd"), waitB(1000),
      motorB(1, "stop"), waitB(500),
      motorB(1, "back"), waitB(1000),
      motorB(1, "stop"), waitB(500),
    ])),
  },
  {
    id: "obstacle-avoid",
    name: "3. Obstacle Avoid (Ultrasonic)",
    ws: foreverB(chain([
      ifB(cmpB("lt", usB(1), num(20)),
        [motorB(1, "back"), motorB(2, "back")],
        [motorB(1, "fwd"), motorB(2, "fwd")]),
      waitB(200),
    ])),
  },
  {
    id: "ir-line-follow",
    name: "4. IR Line Follow",
    ws: foreverB(chain([
      ifB(cmpB("eq", irB(2, "A"), num(1)),
        [motorB(1, "fwd"), motorB(2, "stop")],
        [motorB(1, "stop"), motorB(2, "fwd")]),
      waitB(100),
    ])),
  },
  {
    id: "night-light",
    name: "5. Night Light (LDR)",
    ws: foreverB(chain([
      ifB(cmpB("lt", ldrB("3A"), num(1500)),
        [ledB("on")], [ledB("off")]),
      waitB(500),
    ])),
  },
  {
    id: "temp-alert",
    name: "6. Temperature Alert (DHT11)",
    ws: foreverB(chain([
      ifB(cmpB("gt", dhtB("temp", 4, "A"), num(30)),
        [buzzerB("on"), ledB("on")],
        [buzzerB("off"), ledB("off")]),
      waitB(2000),
    ])),
  },
  {
    id: "ble-hello",
    name: "7. BLE Hello World",
    ws: foreverB(chain([bleSendB("hello"), waitB(2000)])),
  },
  {
    id: "ble-led",
    name: "8. BLE LED Control (send 1/0)",
    ws: foreverB(chain([
      ifB(cmpB("eq", bleRecvB(), num(1)),
        [ledB("on")], [ledB("off")]),
      waitB(500),
    ])),
  },
  {
    id: "servo-sweep",
    name: "9. Servo Sweep (0-90-180)",
    ws: foreverB(chain([
      servoB(2, "A", 0), waitB(1000),
      servoB(2, "A", 90), waitB(1000),
      servoB(2, "A", 180), waitB(1000),
    ])),
  },
  {
    id: "light-level-monitor",
    name: "10. Light Level Monitor (Serial)",
    description: "Reads the LDR on Port 3A, prints each reading, and waits 500 ms before the next sample.",
    ws: foreverB(chain([printValueB(ldrB("3A")), waitB(500)])),
  },
];

/* ==================== Blockly → Behavior JSON ==================== */

function serializeStatementChain(first: Blockly.Block | null): any[] {
  const out: any[] = [];
  let cur = first;
  while (cur) {
    const inst = blockToInstruction(cur);
    if (inst) out.push(inst);
    cur = cur.getNextBlock();
  }
  return out;
}

function num0() { return { type: "num", value: 0 }; }
function boolFalse() { return { type: "cmp", op: "eq", a: num0(), b: num0() }; }

function serializeIfBlock(block: Blockly.Block, elseIfIndex: number): any {
  const cond = blockToExpr(block.getInputTargetBlock(`IF${elseIfIndex}`))
               || boolFalse();
  const thenBody = serializeStatementChain(block.getInputTargetBlock(`DO${elseIfIndex}`));
  const result: any = { type: "if", cond, then: thenBody };

  const nextIf = block.getInputTargetBlock(`IF${elseIfIndex + 1}`);
  if (nextIf) {
    result.else = [serializeIfBlock(block, elseIfIndex + 1)];
  } else {
    const elseBody = serializeStatementChain(block.getInputTargetBlock("ELSE"));
    if (elseBody.length > 0) result.else = elseBody;
  }
  return result;
}

function blockToExpr(block: Blockly.Block | null): any | null {
  if (!block) return null;
  switch (block.type) {
    case "math_number":
      return { type: "num", value: Number(block.getFieldValue("NUM")) || 0 };
    case "math_arithmetic": {
      const op = block.getFieldValue("OP");
      const map: Record<string, string> = { ADD: "add", MINUS: "sub", MULTIPLY: "mul", DIVIDE: "div" };
      return {
        type: map[op] || "add",
        a: blockToExpr(block.getInputTargetBlock("A")) || num0(),
        b: blockToExpr(block.getInputTargetBlock("B")) || num0(),
      };
    }
    case "math_modulo_custom": {
      const a = blockToExpr(block.getInputTargetBlock("A")) || num0();
      const b = blockToExpr(block.getInputTargetBlock("B")) || num0();
      return { type: "modulo", a, b };
    }
    case "math_abs_custom": {
      const a = blockToExpr(block.getInputTargetBlock("A")) || num0();
      return { type: "abs", a };
    }
    case "math_random_custom": {
      const lo = blockToExpr(block.getInputTargetBlock("MIN")) || num0();
      const hi = blockToExpr(block.getInputTargetBlock("MAX")) || num0();
      return { type: "random", a: lo, b: hi };
    }
    case "math_min_custom": {
      const a = blockToExpr(block.getInputTargetBlock("A")) || num0();
      const b = blockToExpr(block.getInputTargetBlock("B")) || num0();
      return { type: "min", a, b };
    }
    case "math_max_custom": {
      const a = blockToExpr(block.getInputTargetBlock("A")) || num0();
      const b = blockToExpr(block.getInputTargetBlock("B")) || num0();
      return { type: "max", a, b };
    }
    case "sensor_ultrasonic": {
      const port = parseInt(block.getFieldValue("PORT"), 10);
      return { type: "sensor", sensor: "ultrasonic", port, field: "cm" };
    }
    case "sensor_ldr": {
      const loc = block.getFieldValue("LOC");
      const port = parseInt(loc.charAt(0), 10);
      const pin  = loc.charAt(1);
      return { type: "sensor", sensor: "ldr", port, pin, field: "pct" };
    }
    case "sensor_soil": {
      const loc = block.getFieldValue("LOC");
      const port = parseInt(loc.charAt(0), 10);
      const pin  = loc.charAt(1);
      return { type: "sensor", sensor: "soil", port, pin, field: "pct" };
    }
    case "sensor_gas": {
      const loc = block.getFieldValue("LOC");
      const port = parseInt(loc.charAt(0), 10);
      const pin  = loc.charAt(1);
      return { type: "sensor", sensor: "gas", port, pin, field: "pct" };
    }
    case "sensor_dht11": {
      const field = block.getFieldValue("FIELD");
      const port = parseInt(block.getFieldValue("PORT"), 10);
      const pin = block.getFieldValue("PIN");
      return { type: "sensor", sensor: "dht11", port, pin, field };
    }
    case "sensor_digital": {
      const port = parseInt(block.getFieldValue("PORT"), 10);
      const pin = block.getFieldValue("PIN");
      return { type: "sensor", sensor: "digital_in", port, pin, field: "level" };
    }
    case "sensor_analog": {
      const loc = block.getFieldValue("LOC");
      const port = parseInt(loc.charAt(0), 10);
      const pin  = loc.charAt(1);
      return { type: "sensor", sensor: "analog_in", port, pin, field: "raw" };
    }
    case "logic_compare": {
      const op = block.getFieldValue("OP");
      const map: Record<string, string> = { EQ: "eq", NEQ: "ne", LT: "lt", LTE: "le", GT: "gt", GTE: "ge" };
      return {
        type: "cmp", op: map[op] || "eq",
        a: blockToExpr(block.getInputTargetBlock("A")) || num0(),
        b: blockToExpr(block.getInputTargetBlock("B")) || num0(),
      };
    }
    case "logic_operation": {
      const op = block.getFieldValue("OP");
      return {
        type: op === "AND" ? "and" : "or",
        a: blockToExpr(block.getInputTargetBlock("A")) || boolFalse(),
        b: blockToExpr(block.getInputTargetBlock("B")) || boolFalse(),
      };
    }
    case "logic_negate":
      return {
        type: "not",
        a: blockToExpr(block.getInputTargetBlock("BOOL")) || boolFalse(),
      };
    case "bool_true":
      return { type: "cmp", op: "eq", a: { type: "num", value: 1 }, b: { type: "num", value: 1 } };
    case "bool_false":
      return { type: "cmp", op: "eq", a: { type: "num", value: 0 }, b: { type: "num", value: 1 } };
    case "sensor_ir": {
      const port = parseInt(block.getFieldValue("PORT"), 10);
      const pin = block.getFieldValue("PIN");
      return { type: "sensor_bool", sensor: "ir", port, pin, field: "detected" };
    }
    case "ble_recv":
      return { type: "ble_recv" };
    case "ble_connected":
      return { type: "ble_connected" };
    default:
      return null;
  }
}

function blockToInstruction(block: Blockly.Block): any | null {
  switch (block.type) {
    case "motor_control": {
      const motor = parseInt(block.getFieldValue("MOTOR"), 10);
      const dir = block.getFieldValue("DIR");
      return { type: "motor", motor, dir };
    }
    case "delay_ms": {
      const ms = blockToExpr(block.getInputTargetBlock("MS")) || num0();
      return { type: "delay", ms };
    }
    case "forever": {
      const first = block.getInputTargetBlock("DO");
      return { type: "forever", body: serializeStatementChain(first) };
    }
    case "run_once": {
      const first = block.getInputTargetBlock("DO");
      return { type: "once", body: serializeStatementChain(first) };
    }
    case "repeat_n": {
      const count = blockToExpr(block.getInputTargetBlock("COUNT")) || num0();
      const first = block.getInputTargetBlock("DO");
      return { type: "repeat", count, body: serializeStatementChain(first) };
    }
    case "wait_until": {
      const cond = blockToExpr(block.getInputTargetBlock("COND")) || boolFalse();
      return { type: "wait_until", cond };
    }
    case "stop_program":
      return { type: "stop" };
    case "controls_if": {
      return serializeIfBlock(block, 0);
    }
    case "oled_print_text": {
      const line = parseInt(block.getFieldValue("LINE"), 10);
      const t = block.getFieldValue("TEXT") || "";
      return { type: "oled_print", line, size: "Big", mode: "text", text: t };
    }
    case "oled_print_num": {
      const line = parseInt(block.getFieldValue("LINE"), 10);
      const v = blockToExpr(block.getInputTargetBlock("VAL")) || num0();
      return { type: "oled_print", line, size: "Big", mode: "number", value: v };
    }
    case "oled_clear":
      return { type: "oled_clear" };
    case "oled_print_text_sized": {
      const line = parseInt(block.getFieldValue("LINE"), 10);
      const size = block.getFieldValue("SIZE");
      const t = block.getFieldValue("TEXT") || "";
      return { type: "oled_print", line, size, mode: "text", text: t };
    }
    case "oled_print_num_sized": {
      const line = parseInt(block.getFieldValue("LINE"), 10);
      const size = block.getFieldValue("SIZE");
      const v = blockToExpr(block.getInputTargetBlock("VAL")) || num0();
      return { type: "oled_print", line, size, mode: "number", value: v };
    }
    case "oled_emoji": {
      const emoji = block.getFieldValue("EMOJI");
      return { type: "oled_emoji", emoji };
    }
    case "oled_animate": {
      const anim_id = parseInt(block.getFieldValue("ANIM"), 10);
      return { type: "oled_animate", anim_id };
    }
    case "led_out": {
      const port = parseInt(block.getFieldValue("PORT"), 10);
      const pin  = block.getFieldValue("PIN");
      const mode = block.getFieldValue("MODE");
      return { type: "led", port, pin, mode };
    }
    case "buzzer_simple": {
      const mode = block.getFieldValue("MODE");
      return { type: "buzzer", mode };
    }
    case "servo_angle": {
      const port  = parseInt(block.getFieldValue("PORT"), 10);
      const pin   = block.getFieldValue("PIN");
      const raw   = block.getFieldValue("ANGLE");
      const n     = Number(raw);
      const angle = Number.isFinite(n) ? n : 90;
      return { type: "servo", port, pin, angle: { type: "num", value: angle } };
    }
    case "print_text": {
      const t = block.getFieldValue("TEXT") || "";
      return { type: "print", mode: "text", text: t };
    }
    case "print_num": {
      const v = blockToExpr(block.getInputTargetBlock("VAL")) || num0();
      return { type: "print", mode: "number", value: v };
    }
    case "ble_enable":
      return { type: "ble_enable" };
    case "ble_send_text": {
      const t = block.getFieldValue("TEXT") || "";
      return { type: "ble_send", mode: "text", text: t };
    }
    case "ble_send_num": {
      const v = blockToExpr(block.getInputTargetBlock("VAL")) || num0();
      return { type: "ble_send", mode: "number", value: v };
    }
    default:
      return null;
  }
}

function serializeWorkspace(ws: Blockly.WorkspaceSvg, deviceId: string): any {
  const instructions: any[] = [];
  for (const top of ws.getTopBlocks(true)) {
    let cur: Blockly.Block | null = top;
    while (cur) {
      const inst = blockToInstruction(cur);
      if (inst) instructions.push(inst);
      cur = cur.getNextBlock();
    }
  }
  return {
    schema_version: 1,
    behavior_version: 1,
    program_id: `web-${Date.now()}`,
    device_id: deviceId,
    instructions,
  };
}

function workspaceSignature(ws: Blockly.WorkspaceSvg) {
  return JSON.stringify((Blockly as any).serialization.workspaces.save(ws));
}

const REQUIRED_VALUE_INPUTS: Record<string, string[]> = {
  math_arithmetic: ["A", "B"], math_modulo_custom: ["A", "B"], math_abs_custom: ["A"],
  math_random_custom: ["MIN", "MAX"], math_min_custom: ["A", "B"], math_max_custom: ["A", "B"],
  logic_compare: ["A", "B"], logic_operation: ["A", "B"], logic_negate: ["BOOL"],
  delay_ms: ["MS"], print_num: ["VAL"], ble_send_num: ["VAL"], repeat_n: ["COUNT"], wait_until: ["COND"],
  oled_print_num: ["VAL"],
  oled_print_num_sized: ["VAL"],
};

const BLOCK_NAMES: Record<string, string> = {
  math_arithmetic: "Math operation", math_modulo_custom: "Remainder operation", math_abs_custom: "Absolute value",
  math_random_custom: "Random value", math_min_custom: "Minimum value", math_max_custom: "Maximum value",
  logic_compare: "Comparison", logic_operation: "Logic operation", logic_negate: "Negation",
  delay_ms: "Wait block", print_num: "Print value block", ble_send_num: "BLE send value block",
  repeat_n: "Repeat block", wait_until: "Wait-until block", sensor_ir: "IR sensor",
  sensor_dht11: "DHT11 sensor", sensor_digital: "Digital sensor", sensor_ultrasonic: "Ultrasonic sensor",
  sensor_ldr: "LDR sensor", sensor_soil: "Soil sensor", sensor_gas: "Gas sensor", sensor_analog: "Analog sensor",
  oled_print_text: "OLED print text", oled_print_num: "OLED print value", oled_clear: "OLED clear",
  oled_print_text_sized: "OLED print text (sized)",
  oled_print_num_sized: "OLED print value (sized)",
  oled_emoji: "OLED emoji",
};
const INPUT_NAMES: Record<string, string> = {
  A: "first value", B: "second value", VAL: "value", MS: "duration", COUNT: "repeat count",
  COND: "condition", BOOL: "condition", MIN: "minimum", MAX: "maximum",
};

function blockDisplayName(block: Blockly.Block) {
  return BLOCK_NAMES[block.type] ?? block.type.replaceAll("_", " ");
}

function validateProgram(workspace: Blockly.WorkspaceSvg, deviceId: string): string[] {
  const errors = validateHardwareResources(workspace);
  const blocks = workspace.getAllBlocks(false).filter((block) => block.isEnabled());
  const topBlocks = workspace.getTopBlocks(false).filter((block) => block.isEnabled());
  const executableTopTypes = new Set([
    "motor_control", "led_out", "buzzer_simple", "servo_angle", "print_text", "print_num",
    "ble_enable", "ble_send_text", "ble_send_num", "delay_ms", "forever", "run_once",
    "repeat_n", "wait_until", "stop_program", "controls_if",
  ]);

  if (!deviceId.trim()) errors.push("Enter a Device ID before verifying the program.");
  if (!topBlocks.some((block) => executableTopTypes.has(block.type))) {
    errors.push("Add an executable block, such as Run once or Forever, before verifying.");
  }

  for (const block of blocks) {
    for (const inputName of REQUIRED_VALUE_INPUTS[block.type] ?? []) {
      if (!block.getInputTargetBlock(inputName)) {
        errors.push(`${blockDisplayName(block)} is missing its ${INPUT_NAMES[inputName] ?? "required value"}.`);
      }
    }
    if ((block.type === "print_text" || block.type === "ble_send_text") && !block.getFieldValue("TEXT")?.trim()) {
      errors.push(`${block.type === "print_text" ? "Print text" : "BLE send text"} needs a message.`);
    }
    if (block.outputConnection && !block.outputConnection.isConnected() && !block.isShadow() && !block.getParent()) {
      errors.push(`${blockDisplayName(block)} is not connected to a value input.`);
    }

    const connections = [block.outputConnection, block.previousConnection, block.nextConnection,
      ...block.inputList.map((input) => input.connection)].filter(Boolean) as Blockly.Connection[];
    for (const connection of connections) {
      const target = connection.targetConnection;
      if (target && target.targetConnection !== connection) {
        errors.push(`${blockDisplayName(block)} has an invalid connection. Disconnect and reconnect it.`);
        break;
      }
    }
  }

  /* M10.15c: OLED line uniqueness — each of the 4 lines can only
   * be claimed by ONE OLED block (print text/num or emoji). */
  const usedOledLines = new Map<number, string>();
  /* M10.15d: emoji is fullscreen — excluded from line-uniqueness */
  const OLED_BLOCK_TYPES = new Set([
    "oled_print_text",
    "oled_print_text_sized",
    "oled_print_num",
    "oled_print_num_sized",
  ]);
  for (const block of blocks) {
    if (OLED_BLOCK_TYPES.has(block.type)) {
      const line = parseInt(block.getFieldValue("LINE"), 10);
      const blockName = blockDisplayName(block);
      if (usedOledLines.has(line)) {
        errors.push(
          `OLED line ${line} is used by two blocks. Each line can only be used once.`
        );
      } else {
        usedOledLines.set(line, blockName);
      }
    }
  }

  return [...new Set(errors)];
}

/* ==================== Status badge ==================== */

type UploadState = "idle" | "uploading" | "waiting" | "stored" | "activated" | "failed";
function statusColor(s: UploadState) {
  return s === "uploading" || s === "waiting" ? "#b17a20" : s === "stored" ? "#507b78"
       : s === "activated" ? "#2e7d32" : s === "failed" ? "#c62828" : "#999";
}

/* ==================== App ==================== */

function App() {
  const blocklyDiv = useRef<HTMLDivElement>(null);
  const wsRef = useRef<Blockly.WorkspaceSvg | null>(null);
  const [json, setJson] = useState("");
  const [userReady, setUserReady] = useState(false);
  const [deviceId, setDeviceId] = useState("STEMBRAIN_91F8");
  const [projectName, setProjectName] = useState("My Program");
  const [connState, setConnState] = useState<"idle" | "checking" | "online" | "offline">("idle");
  const [status, setStatus] = useState("");
  const [txnId, setTxnId] = useState("");
  const [uploadState, setUploadState] = useState<UploadState>("idle");
  const [ackData, setAckData] = useState<any>(null);
  const [verifiedSignature, setVerifiedSignature] = useState("");
  const verifiedSignatureRef = useRef("");
  const [showBleTerminal, setShowBleTerminal] = useState(false);
  const [showJsonViewer, setShowJsonViewer] = useState(false);

  // Status feedback is presented consistently as a short-lived toast. Longer
  // device/upload states remain available through the compact toolbar pills.
  useEffect(() => {
    if (!status) return;
    const timeout = window.setTimeout(() => setStatus(""), 5200);
    return () => window.clearTimeout(timeout);
  }, [status]);

  useEffect(() => {
    if (!blocklyDiv.current || wsRef.current) return;

    if (!Blockly.Blocks['motor_control']) {

      Blockly.defineBlocksWithJsonArray([
        {
          type: "motor_control", message0: "Motor %1 %2",
          args0: [
            { type: "field_dropdown", name: "MOTOR",
              options: [["1","1"],["2","2"],["3","3"],["4","4"]] },
            { type: "field_dropdown", name: "DIR",
              options: [["Forward","fwd"],["Backward","back"],["Stop","stop"]] },
          ],
          previousStatement: null, nextStatement: null,
          colour: 160, tooltip: "Control a motor.",
        },
        {
          type: "ble_enable", message0: "Enable Bluetooth",
          previousStatement: null, nextStatement: null,
          colour: 275, tooltip: "Turn on BLE. Requires reboot if BLE was off.",
        },
        {
          type: "sensor_ultrasonic", message0: "Ultrasonic Port %1",
          args0: [{ type: "field_dropdown", name: "PORT", options: PORT_OPTIONS }],
          output: "Number", colour: 65, tooltip: "Distance in cm.",
        },
        {
          type: "sensor_ir", message0: "IR Port %1 %2",
          args0: [
            { type: "field_dropdown", name: "PORT", options: PORT_OPTIONS },
            { type: "field_dropdown", name: "PIN", options: PIN_OPTIONS },
          ],
        output: ["Number", "Boolean"], colour: 65,
          tooltip: "Digital detection value (0 or 1); can be used as a number or a condition.",
        },
        {
          type: "sensor_ldr", message0: "LDR %1",
          args0: [{ type: "field_dropdown", name: "LOC", options: SENSOR_LOCATION_OPTIONS }],
          output: "Number", colour: 65, tooltip: "Light level (raw ADC).",
        },
        {
          type: "sensor_soil", message0: "Soil Moisture %1",
          args0: [{ type: "field_dropdown", name: "LOC", options: SENSOR_LOCATION_OPTIONS }],
          output: "Number", colour: 65, tooltip: "Soil moisture (raw ADC).",
        },
        {
          type: "sensor_gas", message0: "Gas %1",
          args0: [{ type: "field_dropdown", name: "LOC", options: SENSOR_LOCATION_OPTIONS }],
          output: "Number", colour: 65, tooltip: "Gas sensor (raw ADC).",
        },
        {
          type: "sensor_dht11", message0: "DHT11 %1 Port %2 %3",
          args0: [
            { type: "field_dropdown", name: "FIELD",
              options: [["temp","temp"],["humidity","rh"]] },
            { type: "field_dropdown", name: "PORT", options: PORT_OPTIONS },
            { type: "field_dropdown", name: "PIN", options: PIN_OPTIONS },
          ],
          output: "Number", colour: 65, tooltip: "Temperature or humidity.",
        },
        {
          type: "sensor_digital", message0: "Digital Sensor Port %1 %2",
          args0: [
            { type: "field_dropdown", name: "PORT", options: PORT_OPTIONS },
            { type: "field_dropdown", name: "PIN", options: PIN_OPTIONS },
          ],
          output: "Number", colour: 65,
          tooltip: "Generic digital input (0 or 1).",
        },
        {
          type: "sensor_analog", message0: "Analog Sensor %1",
          args0: [{ type: "field_dropdown", name: "LOC", options: SENSOR_LOCATION_OPTIONS }],
          output: "Number", colour: 65,
          tooltip: "Generic analog input (raw ADC, 0-4095).",
        },
        {
          type: "led_out", message0: "LED Port %1 %2 %3",
          args0: [
            { type: "field_dropdown", name: "PORT", options: PORT_OPTIONS },
            { type: "field_dropdown", name: "PIN", options: PIN_OPTIONS },
            { type: "field_dropdown", name: "MODE",
              options: [["ON","on"],["OFF","off"]] },
          ],
          previousStatement: null, nextStatement: null,
          colour: 20, tooltip: "External LED on a port pin.",
        },
        {
          type: "buzzer_simple", message0: "Buzzer %1",
          args0: [
            { type: "field_dropdown", name: "MODE",
              options: [["ON","on"],["OFF","off"]] },
          ],
          previousStatement: null, nextStatement: null,
          colour: 20, tooltip: "Built-in buzzer.",
        },
        {
          type: "servo_angle", message0: "Servo Port %1 %2 to %3\u00B0",
          args0: [
            { type: "field_dropdown", name: "PORT", options: PORT_OPTIONS },
            { type: "field_dropdown", name: "PIN", options: PIN_OPTIONS },
            { type: "field_number", name: "ANGLE", value: 90, min: 0, max: 180, precision: 1 },
          ],
          previousStatement: null, nextStatement: null,
          colour: 20, tooltip: "Servo angle (0-180).",
        },
        {
          type: "print_text", message0: "Print text %1",
          args0: [{ type: "field_input", name: "TEXT", text: "Hello" }],
          previousStatement: null, nextStatement: null,
          colour: 290, tooltip: "Print text to serial.",
        },
        {
          type: "print_num", message0: "Print value %1",
          args0: [{ type: "input_value", name: "VAL", check: "Number" }],
          previousStatement: null, nextStatement: null,
          colour: 290, tooltip: "Print a number to serial.",
        },
        {
          type: "ble_send_text", message0: "BLE send text %1",
          args0: [{ type: "field_input", name: "TEXT", text: "Hello" }],
          previousStatement: null, nextStatement: null,
          colour: 275, tooltip: "Send text over BLE.",
        },
        {
          type: "ble_send_num", message0: "BLE send value %1",
          args0: [{ type: "input_value", name: "VAL", check: "Number" }],
          previousStatement: null, nextStatement: null,
          colour: 275, tooltip: "Send number over BLE.",
        },
        {
          type: "ble_recv", message0: "BLE received value",
          output: "Number", colour: 275,
          tooltip: "Last integer received over BLE.",
        },
        {
          type: "ble_connected", message0: "BLE connected?",
          output: "Boolean", colour: 275,
          tooltip: "True if a phone is connected.",
        },
        {
          type: "delay_ms", message0: "wait %1 ms",
          args0: [{ type: "input_value", name: "MS", check: "Number" }],
          previousStatement: null, nextStatement: null,
          colour: 210, tooltip: "Delay in ms.",
        },
        {
          type: "forever", message0: "forever", message1: "%1",
          args1: [{ type: "input_statement", name: "DO" }],
          previousStatement: null, nextStatement: null,
          colour: 120, tooltip: "Loop forever.",
        },
        {
          type: "run_once", message0: "once", message1: "%1",
          args1: [{ type: "input_statement", name: "DO" }],
          previousStatement: null, nextStatement: null,
          colour: 120, tooltip: "Run once (no loop).",
        },
        {
          type: "repeat_n", message0: "repeat %1 times", message1: "%1",
          args0: [{ type: "input_value", name: "COUNT", check: "Number" }],
          args1: [{ type: "input_statement", name: "DO" }],
          previousStatement: null, nextStatement: null,
          colour: 120, tooltip: "Repeat N times.",
        },
        {
          type: "wait_until", message0: "wait until %1",
          args0: [{ type: "input_value", name: "COND", check: "Boolean" }],
          previousStatement: null, nextStatement: null,
          colour: 120, tooltip: "Wait until condition becomes true.",
        },
        {
          type: "stop_program", message0: "stop program",
          previousStatement: null,
          colour: 120, tooltip: "End the program.",
        },
        {
          type: "bool_true", message0: "true",
          output: "Boolean", colour: 230,
          tooltip: "Boolean constant TRUE.",
        },
        {
          type: "bool_false", message0: "false",
          output: "Boolean", colour: 230,
          tooltip: "Boolean constant FALSE.",
        },
        {
          type: "math_modulo_custom", message0: "%1 mod %2",
          args0: [
            { type: "input_value", name: "A", check: "Number" },
            { type: "input_value", name: "B", check: "Number" },
          ],
          inputsInline: true, output: "Number", colour: 240,
          tooltip: "Remainder of A / B.",
        },
        {
          type: "math_abs_custom", message0: "abs %1",
          args0: [{ type: "input_value", name: "A", check: "Number" }],
          output: "Number", colour: 240,
          tooltip: "Absolute value.",
        },
        {
          type: "math_random_custom", message0: "random %1 to %2",
          args0: [
            { type: "input_value", name: "MIN", check: "Number" },
            { type: "input_value", name: "MAX", check: "Number" },
          ],
          inputsInline: true, output: "Number", colour: 240,
          tooltip: "Random integer in range.",
        },
        {
          type: "math_min_custom", message0: "min %1 %2",
          args0: [
            { type: "input_value", name: "A", check: "Number" },
            { type: "input_value", name: "B", check: "Number" },
          ],
          inputsInline: true, output: "Number", colour: 240,
          tooltip: "Smaller of two values.",
        },
        {
          type: "math_max_custom", message0: "max %1 %2",
          args0: [
            { type: "input_value", name: "A", check: "Number" },
            { type: "input_value", name: "B", check: "Number" },
          ],
          inputsInline: true, output: "Number", colour: 240,
          tooltip: "Larger of two values.",
        },
        {
          type: "oled_print_text", message0: "OLED line %1 = text %2",
          args0: [
            { type: "field_dropdown", name: "LINE",
              options: [["1","1"],["2","2"],["3","3"],["4","4"]] },
            { type: "field_input", name: "TEXT", text: "Hello" },
          ],
          previousStatement: null, nextStatement: null,
          colour: 300, tooltip: "Display text on OLED line 1-4.",
        },
        {
          type: "oled_print_num", message0: "OLED line %1 = value %2",
          args0: [
            { type: "field_dropdown", name: "LINE",
              options: [["1","1"],["2","2"],["3","3"],["4","4"]] },
            { type: "input_value", name: "VAL", check: "Number" },
          ],
          previousStatement: null, nextStatement: null,
          colour: 300, tooltip: "Display a number on OLED line 1-4.",
        },
        {
          type: "oled_clear", message0: "OLED clear",
          previousStatement: null, nextStatement: null,
          colour: 300, tooltip: "Clear all 4 OLED lines.",
        },
        {
          type: "oled_print_text_sized",
          message0: "OLED line %1 %2 text %3",
          args0: [
            { type: "field_dropdown", name: "LINE",
              options: [["1","1"],["2","2"],["3","3"],["4","4"]] },
            { type: "field_dropdown", name: "SIZE",
              options: [["Big","Big"],["Small","Small"]] },
            { type: "field_input", name: "TEXT", text: "Hello" },
          ],
          previousStatement: null, nextStatement: null,
          colour: 300, tooltip: "Display text on OLED line 1-4 (Big or Small).",
        },
        {
          type: "oled_print_num_sized",
          message0: "OLED line %1 %2 value %3",
          args0: [
            { type: "field_dropdown", name: "LINE",
              options: [["1","1"],["2","2"],["3","3"],["4","4"]] },
            { type: "field_dropdown", name: "SIZE",
              options: [["Big","Big"],["Small","Small"]] },
            { type: "input_value", name: "VAL", check: "Number" },
          ],
          previousStatement: null, nextStatement: null,
          colour: 300, tooltip: "Display a number on OLED line 1-4 (Big or Small).",
        },
        {
          type: "oled_emoji", message0: "OLED emoji %1",
          args0: [
            { type: "field_dropdown", name: "EMOJI",
              options: [
                ["😊 Happy",    "happy"],
                ["😢 Sad",      "sad"],
                ["❤️ Love",     "love"],
                ["😠 Angry",    "angry"],
                ["😎 Cool",     "cool"],
                ["😉 Wink",     "wink"],
                ["😮 Surprise", "surprise"],
                ["😴 Sleepy",   "sleepy"],
                ["😕 Confused", "confused"],
                ["😐 Neutral",  "neutral"],
              ] },
          ],
          previousStatement: null, nextStatement: null,
          colour: 300, tooltip: "Show emoji on fullscreen OLED.",
        },
        {
          type: "oled_animate", message0: "OLED animate %1",
          args0: [
            { type: "field_dropdown", name: "ANIM",
              options: [
                ["Cool",    "0"],
                ["Info",    "1"],
                ["Bird",    "2"],
                ["Music",   "3"],
                ["Sunrise", "4"],
                ["Car",     "5"],
                ["Home",    "6"],
                ["Weather", "7"],
              ] },
          ],
          previousStatement: null, nextStatement: null,
          colour: 300, tooltip: "Play a fullscreen animation on the OLED.",
        },
      ]);

      (Blockly.Blocks as any)['logic_compare'] = {
        init: function (this: Blockly.Block) {
          (this as any).jsonInit({
            message0: "%1 %2 %3",
            args0: [
              { type: "input_value", name: "A" },
              {
                type: "field_dropdown", name: "OP",
                options: [["=","EQ"],["\u2260","NEQ"],["<","LT"],["\u2264","LTE"],[">","GT"],["\u2265","GTE"]],
              },
              { type: "input_value", name: "B" },
            ],
            inputsInline: true,
            output: "Boolean",
            colour: 230,
            tooltip: "Compare two values.",
          });
        },
      };
    }

    // Blockly's built-in blocks keep their default hues unless the block
    // definitions are aligned explicitly with the category palette.
    const categoryHues: Record<string, number> = {
      forever: 120, run_once: 120, delay_ms: 120,
      motor_control: 205,
      sensor_ultrasonic: 28, sensor_ir: 28, sensor_ldr: 28, sensor_soil: 28,
      sensor_gas: 28, sensor_dht11: 28, sensor_digital: 28, sensor_analog: 28,
      led_out: 270, buzzer_simple: 270, servo_angle: 270,
      ble_enable: 185, ble_send_text: 185, ble_send_num: 185, ble_recv: 185, ble_connected: 185,
      print_text: 150, print_num: 150,
      oled_print_text: 325, oled_print_num: 325, oled_print_text_sized: 325,
      oled_print_num_sized: 325, oled_emoji: 325, oled_animate: 325, oled_clear: 325,
      repeat_n: 5, wait_until: 5, stop_program: 5, controls_if: 5,
      logic_compare: 48, logic_operation: 48, logic_negate: 48, bool_true: 48, bool_false: 48,
      math_number: 220, math_arithmetic: 220, math_modulo_custom: 220, math_abs_custom: 220,
      math_random_custom: 220, math_min_custom: 220, math_max_custom: 220,
    };
    for (const [type, hue] of Object.entries(categoryHues)) {
      const definition = (Blockly.Blocks as any)[type];
      if (!definition?.init || definition.categoryHueApplied) continue;
      const originalInit = definition.init;
      definition.init = function (this: Blockly.Block) {
        originalInit.call(this);
        this.setColour(hue);
      };
      definition.categoryHueApplied = true;
    }

    installHardwareDropdowns();
    wsRef.current = Blockly.inject(blocklyDiv.current, {
      toolbox: {
        kind: "categoryToolbox",
        contents: [
          { kind: "category", name: "Setup", colour: "120",
            contents: [
              { kind: "block", type: "forever" },
              { kind: "block", type: "run_once" },
              { kind: "block", type: "delay_ms" },
            ] },
          { kind: "category", name: "Motors", colour: "205",
            contents: [{ kind: "block", type: "motor_control" }] },
          { kind: "category", name: "Sensors", colour: "28",
            contents: [
              { kind: "block", type: "sensor_ultrasonic" },
              { kind: "block", type: "sensor_ir" },
              { kind: "block", type: "sensor_ldr" },
              { kind: "block", type: "sensor_soil" },
              { kind: "block", type: "sensor_gas" },
              { kind: "block", type: "sensor_dht11" },
              { kind: "block", type: "sensor_digital" },
              { kind: "block", type: "sensor_analog" },
            ] },
          { kind: "category", name: "Output", colour: "270",
            contents: [
              { kind: "block", type: "led_out" },
              { kind: "block", type: "buzzer_simple" },
              { kind: "block", type: "servo_angle" },
            ] },
          { kind: "category", name: "Bluetooth", colour: "185",
            contents: [
              { kind: "block", type: "ble_enable" },
              { kind: "block", type: "ble_send_text" },
              { kind: "block", type: "ble_send_num" },
              { kind: "block", type: "ble_recv" },
              { kind: "block", type: "ble_connected" },
            ] },
          { kind: "category", name: "Print", colour: "150",
            contents: [
              { kind: "block", type: "print_text" },
              { kind: "block", type: "print_num" },
            ] },
          { kind: "category", name: "Display", colour: "325",
            contents: [
              { kind: "block", type: "oled_print_text_sized" },
              { kind: "block", type: "oled_print_num_sized" },
              { kind: "block", type: "oled_emoji" },
              { kind: "block", type: "oled_animate" },   /* M10.16 */
              { kind: "block", type: "oled_clear" },
            ] },
          { kind: "category", name: "Control", colour: "5",
            contents: [
              { kind: "block", type: "repeat_n" },
              { kind: "block", type: "wait_until" },
              { kind: "block", type: "stop_program" },
              {
                kind: "block", type: "controls_if",
                inputs: {
                  IF0: {
                    shadow: {
                      type: "logic_compare",
                      inputs: {
                        A: { shadow: { type: "math_number", fields: { NUM: 0 } } },
                        B: { shadow: { type: "math_number", fields: { NUM: 0 } } },
                      },
                    },
                  },
                },
              },
            ] },
          { kind: "category", name: "Logic", colour: "48",
            contents: [
              {
                kind: "block", type: "logic_compare",
                inputs: {
                  A: { shadow: { type: "math_number", fields: { NUM: 0 } } },
                  B: { shadow: { type: "math_number", fields: { NUM: 0 } } },
                },
              },
              {
                kind: "block", type: "logic_operation",
                inputs: {
                  A: { shadow: { type: "bool_true" } },
                  B: { shadow: { type: "bool_false" } },
                },
              },
              { kind: "block", type: "logic_negate" },
              { kind: "block", type: "bool_true" },
              { kind: "block", type: "bool_false" },
            ] },
          { kind: "category", name: "Math", colour: "220",
            contents: [
              { kind: "block", type: "math_number" },
              { kind: "block", type: "math_arithmetic" },
              { kind: "block", type: "math_modulo_custom" },
              { kind: "block", type: "math_abs_custom" },
              { kind: "block", type: "math_random_custom" },
              { kind: "block", type: "math_min_custom" },
              { kind: "block", type: "math_max_custom" },
            ] },
        ],
      },
      grid: { spacing: 20, length: 3, colour: "#ccc", snap: true },
      zoom: { controls: true, wheel: true, startScale: 1.0 },
      trashcan: true,
    });

    const workspace = wsRef.current;
    let reconcileTimer = 0;
    workspace.addChangeListener((event) => {
      if (event.type === Blockly.Events.UI) return;
      verifiedSignatureRef.current = "";
      setVerifiedSignature("");
      window.clearTimeout(reconcileTimer);
      reconcileTimer = window.setTimeout(() => reconcileHardwareResources(workspace), 0);
    });

    return () => {
      window.clearTimeout(reconcileTimer);
      wsRef.current?.dispose();
      wsRef.current = null;
    };
  }, []);

  /* Load persisted project name on mount */
  useEffect(() => {
    const saved = localStorage.getItem(PROJECT_KEY);
    if (saved) setProjectName(saved);
  }, []);

  useEffect(() => {
    signInAnonymously(auth).catch(() => setStatus("Unable to establish a cloud session. Please refresh and try again."));
    const unsub = onAuthStateChanged(auth, (u) => setUserReady(!!u));
    return () => unsub();
  }, []);

  useEffect(() => {
    if (!txnId) return;
    const ackRef = ref(db, `devices/${deviceId}/ack/${txnId}`);
    const handler = (snap: any) => {
      const val = snap.val();
      setAckData(val);
      if (!val) return;
      if (val.status === "ACTIVATED") {
        setUploadState("activated");
        setStatus("Upload complete. The program is now active on the device.");
      } else if (val.status === "STORED") {
        setUploadState("stored");
        setStatus("The device received and stored the program.");
      } else if (val.status === "FAILED") {
        setUploadState("failed");
        setStatus(`The device could not activate the program${val.error_reason ? `: ${val.error_reason}` : ". Review the device configuration and try again."}`);
      }
    };
    onValue(ackRef, handler);
    return () => off(ackRef, "value", handler);
  }, [txnId, deviceId]);

  const handleGetJson = () => {
    if (!wsRef.current) return;
    setJson(JSON.stringify(serializeWorkspace(wsRef.current, deviceId), null, 2));
    setShowJsonViewer(true);
  };

  const handleVerify = () => {
    const workspace = wsRef.current;
    if (!workspace) return;
    reconcileHardwareResources(workspace);
    const errors = validateProgram(workspace, deviceId);
    if (errors.length) {
      verifiedSignatureRef.current = "";
      setVerifiedSignature("");
      setStatus(`Verification failed. Please fix the highlighted issues before uploading. ${errors[0]}`);
      return;
    }

    const signature = workspaceSignature(workspace);
    verifiedSignatureRef.current = signature;
    setVerifiedSignature(signature);
    setStatus("Verification successful. Your program is ready to upload.");
  };

  const handleNewFile = () => {
    if (!wsRef.current) return;
    if (!window.confirm("Start a new program? Unsaved changes will be lost.")) return;
    wsRef.current.clear();
    setProjectName("My Program");
    localStorage.setItem(PROJECT_KEY, "My Program");
    setStatus("A new workspace is ready.");
  };

  /* M10.14: Save workspace as downloadable file */
  const handleSaveFile = () => {
    if (!wsRef.current) return;
    try {
      const state = (Blockly as any).serialization.workspaces.save(wsRef.current);
      const payload = {
        format: "stembrain-workspace-v1",
        project_name: projectName || "program",
        saved_at: new Date().toISOString(),
        workspace: state,
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)],
                            { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const safeName = (projectName || "program").replace(/[^a-zA-Z0-9_\-]/g, "_");
      a.href = url;
      a.download = `${safeName}.stembrain.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setStatus(`Project saved as ${safeName}.stembrain.json.`);
    } catch (e: any) {
      setStatus(`Unable to save the project. ${e.message}`);
    }
  };

  /* M10.14: Open a saved workspace file */
  const handleOpenFile = () => {
    if (!wsRef.current) return;
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json,.stembrain,application/json";
    input.onchange = async (e: any) => {
      const file = e.target.files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const data = JSON.parse(text);
        const state = data.workspace ?? data;
        const proj = data.project_name ?? file.name.replace(/\.[^.]+$/, "");
        wsRef.current!.clear();
        (Blockly as any).serialization.workspaces.load(state, wsRef.current!);
        setProjectName(proj);
        localStorage.setItem(PROJECT_KEY, proj);
        setStatus(`Project loaded from ${file.name}.`);
      } catch (err: any) {
        setStatus(`Unable to open this project file. ${err.message}`);
      }
    };
    input.click();
  };

  const handleLoadExample = (example: typeof EXAMPLES[number]) => {
    if (!wsRef.current) return;
    try {
      wsRef.current.clear();
      (Blockly as any).serialization.workspaces.load(example.ws, wsRef.current);
      setStatus(example.description
        ? `${example.name.replace(/^\d+\.\s*/, "")} — ${example.description}`
        : "Example loaded. Verify the program before uploading it.");
    } catch (e: any) {
      setStatus(`Unable to load this example. ${e.message}`);
    }
  };

  const handleProjectNameChange = (name: string) => {
    setProjectName(name);
    localStorage.setItem(PROJECT_KEY, name);
  };

  const handleConnect = async () => {
    if (!deviceId.trim()) {
      setConnState("offline");
      setStatus("Enter a device ID before checking its connection.");
      return;
    }
    setConnState("checking");
    setStatus("");
    try {
      const snap = await get(ref(db, `devices/${deviceId}/presence`));
      if (!snap.exists()) {
        setConnState("offline");
        setStatus(`Device ${deviceId} was not found. Check the ID and try again.`);
        return;
      }
      const pres = snap.val();
      const lastSeen = Number(pres.last_seen) || 0;
      const ageMs = Date.now() - lastSeen;
      const STALE_MS = 10 * 60 * 1000;

      if (pres.online === true && ageMs < STALE_MS) {
        setConnState("online");
        setStatus("Device is online.");
      } else if (pres.online === true && ageMs >= STALE_MS) {
        setConnState("offline");
        setStatus("Device is offline.");
      } else {
        setConnState("offline");
        setStatus("The device is currently offline.");
      }
    } catch (e: any) {
      setConnState("offline");
      setStatus(`Unable to check the device connection. ${e.message}`);
    }
  };

  const handleUpload = async () => {
    if (!wsRef.current || !userReady) return;
    const workspace = wsRef.current;
    const currentSignature = workspaceSignature(workspace);
    if (!verifiedSignatureRef.current || verifiedSignatureRef.current !== currentSignature) {
      verifiedSignatureRef.current = "";
      setVerifiedSignature("");
      setStatus("Verify the current program before uploading. Any changes require a new verification.");
      return;
    }
    const errors = validateProgram(workspace, deviceId);
    if (errors.length) {
      verifiedSignatureRef.current = "";
      setVerifiedSignature("");
      setStatus(`Upload blocked: ${errors[0]}`);
      return;
    }
    const obj = serializeWorkspace(workspace, deviceId);
    const newTxn = `web-txn-${Date.now()}`;
    setJson(JSON.stringify(obj, null, 2));
    setAckData(null); setTxnId(newTxn);
    setUploadState("uploading");
    setStatus("");
    try {
      await set(ref(db, `devices/${deviceId}/inbox/${newTxn}`), obj);
      setUploadState("waiting");
      setStatus("");
    } catch (e: any) {
      setUploadState("failed"); setStatus(`Program upload failed. ${e.message}`);
    }
  };

  const btn = (label: string, onClick: () => void, disabled = false) => (
    <button
      className={`app-btn ${label === "Upload" ? "primary" : ""}`}
      onClick={onClick}
      disabled={disabled}
      title={label === "Upload" && !verifiedSignature
        ? "Verify the current program before uploading."
        : label === "Upload" && connState !== "online"
          ? "Connect to an online device before uploading."
          : undefined}
      style={{
      padding: "8px 16px", fontSize: 14,
      background: disabled ? "#999" : "#fff", color: "#1565c0",
      border: 0, borderRadius: 4,
      cursor: disabled ? "not-allowed" : "pointer",
      fontWeight: 600, marginLeft: 8,
    }}
    >{label}</button>
  );

  return (
    <div className="app-shell" style={{ fontFamily: "system-ui, sans-serif", height: "100vh", display: "flex", flexDirection: "column" }}>

      {/* ============ Header ============ */}
      <div className="app-header" style={{ padding: "10px 16px", background: "#1565c0", color: "#fff", display: "flex", alignItems: "center", gap: 12 }}>
        <img className="brand-logo" src={logoUrl} alt="STEMBRAIN logo" />
        <strong className="brand-title">STEMBRAIN <span style={{ fontWeight: 500 }}>Web IDE</span></strong>
        <input
          value={projectName}
          onChange={(e) => handleProjectNameChange(e.target.value)}
          placeholder="Project name…"
          className="project-input"
          style={{
            marginLeft: 12, padding: "4px 10px", fontSize: 13,
            background: "rgba(255,255,255,0.15)", color: "#fff",
            border: "1px solid rgba(255,255,255,0.4)", borderRadius: 4,
            width: 200, fontWeight: 500, outline: "none",
          }}
        />
        <span className="auth-status" style={{ fontSize: 12, marginLeft: "auto", opacity: userReady ? 1 : 0.6 }}>
          {userReady ? "● Cloud session ready" : "○ Connecting to cloud…"}
        </span>
      </div>

      {/* ============ Toolbar ============ */}
      <div className="action-bar" style={{ padding: "10px 16px", background: "#e3f2fd", display: "flex", alignItems: "center", gap: 8, borderBottom: "1px solid #ccc", flexWrap: "wrap" }}>
        <label htmlFor="device-id" style={{ fontWeight: 600, fontSize: 14 }}>Device ID</label>
        <input id="device-id" className="device-input" value={deviceId} onChange={(e) => setDeviceId(e.target.value)}
          style={{ padding: "6px 10px", fontSize: 14, width: 180, border: "1px solid #999", borderRadius: 4 }} />
        {btn("Connect", handleConnect, !userReady)}
        {btn("Verify", handleVerify)}
        {btn("Upload", handleUpload, !userReady || connState !== "online" || !verifiedSignature)}
        {btn("New", handleNewFile)}
        {btn("Save", handleSaveFile)}
        {btn("Open", handleOpenFile)}
        {btn("Get JSON", handleGetJson)}

        <select
          className="examples-select"
          aria-label="Load an example program"
          defaultValue=""
          onChange={(e) => {
            const ex = EXAMPLES.find((x) => x.id === e.target.value);
            if (ex) handleLoadExample(ex);
            e.target.value = "";
          }}
          style={{
            marginLeft: 8, padding: "8px 12px", fontSize: 13, fontWeight: 600,
            background: "#7c4dff", color: "#fff", border: 0, borderRadius: 4,
            cursor: "pointer", appearance: "none" as any,
          }}
        >
          <option value="" disabled>Examples ▼</option>
          {EXAMPLES.map((ex) => (
            <option key={ex.id} value={ex.id} style={{ background: "#fff", color: "#000" }}>
              {ex.name}
            </option>
          ))}
        </select>

        <button
          className="app-btn ble-open"
          onClick={() => setShowBleTerminal(true)}
          style={{
            marginLeft: "auto", padding: "8px 16px", fontSize: 13, fontWeight: 600,
            background: "#0d47a1", color: "#fff", border: 0, borderRadius: 4,
            cursor: "pointer",
          }}
        >
          🔵 BLE Terminal
        </button>

        {connState !== "idle" && (
          <span className={`state-pill ${connState}`} style={{
            marginLeft: 12, padding: "4px 10px", borderRadius: 4, fontSize: 13,
            background: connState === "online" ? "#2e7d32" : connState === "offline" ? "#c62828" : "#666",
            color: "#fff", fontWeight: 600,
          }}>
            {connState === "checking" ? <><span className="status-spinner" aria-hidden="true" />Checking…</> : connState === "online" ? "Online" : "Offline"}
          </span>
        )}
        {uploadState !== "idle" && (
          <span className={`state-pill ${uploadState}`} style={{
            marginLeft: 8, padding: "4px 10px", borderRadius: 4, fontSize: 13,
            background: statusColor(uploadState), color: "#fff", fontWeight: 600,
          }}>
            {uploadState === "uploading" ? <><span className="status-spinner" aria-hidden="true" />Uploading…</>
              : uploadState === "waiting" ? <><span className="status-spinner" aria-hidden="true" />WAITING FOR DEVICE</>
              : uploadState === "activated" ? "Active"
              : uploadState === "stored" ? "Stored"
              : "Upload failed"}
          </span>
        )}
      </div>

      {/* ============ Temporary notifications ============ */}
      {status && (
        <div className={`toast ${/failed|unable|error|could not|not found|offline|enter a device/i.test(status) ? "error" : /successful|complete|ready|online|saved|loaded|ready/i.test(status) ? "success" : "info"}`}
          role="status" aria-live="polite">
          <span className="toast-mark" aria-hidden="true">{/failed|unable|error|could not|not found|offline/i.test(status) ? "!" : /successful|complete|online|saved|loaded/i.test(status) ? "✓" : "i"}</span>
          <span className="toast-message">{status}{ackData?.error_code ? ` (${ackData.error_code}${ackData.error_reason ? `: ${ackData.error_reason}` : ""})` : ""}</span>
          <button className="toast-close" aria-label="Dismiss notification" onClick={() => setStatus("")}>×</button>
        </div>
      )}

      {/* ============ Full-width Workspace ============ */}
      <div className="workspace-frame" style={{ flex: 1, display: "flex", minHeight: 0 }}>
        <div className="workspace-canvas" ref={blocklyDiv} style={{ flex: 1, minWidth: 0 }} />
      </div>

      {/* ============ JSON Viewer modal ============ */}
      {showJsonViewer && (
        <div
          className="modal-backdrop"
          style={{
            position: "fixed", inset: 0, background: "rgba(0,0,0,0.65)",
            display: "flex", alignItems: "center", justifyContent: "center",
            zIndex: 1000,
          }}
          onClick={() => setShowJsonViewer(false)}
        >
          <div
            className="json-modal"
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "min(900px, 95vw)", height: "min(700px, 90vh)",
              background: "#1e1e1e", borderRadius: 8, overflow: "hidden",
              display: "flex", flexDirection: "column",
              boxShadow: "0 10px 40px rgba(0,0,0,0.5)",
            }}
          >
            <div className="modal-header" style={{
              padding: "12px 16px", background: "#1565c0", color: "#fff",
              display: "flex", alignItems: "center", gap: 12,
            }}>
              <strong>Generated Behavior JSON</strong>
              <button
                className="app-btn close-btn"
                onClick={() => setShowJsonViewer(false)}
                style={{
                  marginLeft: "auto", padding: "6px 14px", fontSize: 14,
                  background: "#c62828", color: "#fff", border: 0, borderRadius: 4,
                  cursor: "pointer", fontWeight: 600,
                }}
              >Close</button>
            </div>
            <div className="json-content" style={{
              flex: 1, overflow: "auto", padding: 16, background: "#0d0d0d",
              fontFamily: "Consolas, monospace", fontSize: 13, color: "#d4d4d4",
              whiteSpace: "pre",
            }}>
              {json || "// No JSON yet — build a program and click 'Get JSON'"}
            </div>
          </div>
        </div>
      )}

      {showBleTerminal && (
        <BleTerminal onClose={() => setShowBleTerminal(false)} />
      )}
    </div>
  );
}

export default App;


