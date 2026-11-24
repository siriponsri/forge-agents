// Public APIs verified against published @univerjs/* 1.6.1 declarations and source.
// Only the preset for the active document kind is registered on each instance.
import { assertDurableSnapshot, boundedSheetEdit } from "./api.mjs";
export const PACKAGE_VERSION = "1.6.1";
export function newSnapshot(kind, name) {
  const id = crypto.randomUUID();
  if (kind === "sheet")
    return {
      id,
      name,
      appVersion: PACKAGE_VERSION,
      locale: "enUS",
      sheetOrder: ["sheet1"],
      sheets: {
        sheet1: {
          id: "sheet1",
          name: "Sheet1",
          rowCount: 1000,
          columnCount: 26,
          cellData: {},
        },
      },
      styles: {},
      resources: [],
    };
  return {
    id,
    title: name,
    body: {
      dataStream: "\r\n",
      paragraphs: [{ startIndex: 0 }],
      sectionBreaks: [{ startIndex: 1 }],
    },
    documentStyle: {
      pageSize: { width: 794, height: 1123 },
      marginTop: 72,
      marginBottom: 72,
      marginLeft: 72,
      marginRight: 72,
    },
    resources: [],
  };
}
export async function mountEditor(container, record, onChange) {
  if (record.packageVersion && record.packageVersion !== PACKAGE_VERSION)
    throw new Error(
      `Snapshot requires Univer ${record.packageVersion}; installed ${PACKAGE_VERSION}. Download it for recovery or open with the matching version.`,
    );
  const { createUniver, LocaleType, defaultTheme } =
    await import("@univerjs/presets");
  let preset, locale;
  if (record.kind === "sheet") {
    const [module, language] = await Promise.all([
      import("@univerjs/preset-sheets-core"),
      import("@univerjs/preset-sheets-core/locales/en-US"),
      import("@univerjs/preset-sheets-core/lib/index.css"),
    ]);
    preset = module.UniverSheetsCorePreset({
      container,
      header: true,
      toolbar: true,
    });
    locale = language.default;
  } else if (record.kind === "doc") {
    const [module, language] = await Promise.all([
      import("@univerjs/preset-docs-core"),
      import("@univerjs/preset-docs-core/locales/en-US"),
      import("@univerjs/preset-docs-core/lib/index.css"),
    ]);
    preset = module.UniverDocsCorePreset({
      container,
      header: true,
      toolbar: true,
    });
    locale = language.default;
  } else throw new Error("Unsupported native document kind.");
  const theme = {
    ...defaultTheme,
    primary: {
      ...defaultTheme.primary,
      500: "#be521e",
      600: "#a74415",
      700: "#873511",
    },
  };
  const { univer, univerAPI } = createUniver({
    locale: LocaleType.EN_US,
    locales: { [LocaleType.EN_US]: locale },
    theme,
    presets: [preset],
  });
  try {
    const snapshot = structuredClone(
      record.snapshot || newSnapshot(record.kind, record.name),
    );
    const unit =
      record.kind === "sheet"
        ? univerAPI.createWorkbook(snapshot)
        : univerAPI.createDocument(snapshot);
    if (!unit || typeof unit.save !== "function")
      throw new Error("Native snapshot API is unavailable.");
    let timeout;
    const subscription = univerAPI.addEvent(
      univerAPI.Event.CommandExecuted,
      () => {
        clearTimeout(timeout);
        timeout = setTimeout(onChange, 80);
      },
    );
    return {
      snapshot: () => assertDurableSnapshot(structuredClone(unit.save())),
      rawSnapshot: () => structuredClone(unit.save()),
      undo: () => (record.kind === "doc" ? unit.undo() : univerAPI.undo()),
      redo: () => (record.kind === "doc" ? unit.redo() : univerAPI.redo()),
      dark: (value) => univerAPI.toggleDarkMode(value),
      apply: (edit) => {
        if (edit.kind === "sheet.setValues" && record.kind === "sheet") {
          const parsed = boundedSheetEdit(edit.range, edit.text);
          const sheet = unit.getActiveSheet();
          if (!sheet || typeof sheet.getRange !== "function")
            throw new Error("Active sheet is unavailable.");
          // One public command gives a single live undo boundary for the batch.
          sheet.getRange(parsed.range).setValues(parsed.values);
          return {
            region: `${sheet.getSheetId()}!${parsed.range}`,
            summary: `Set ${parsed.range}`,
          };
        }
        if (edit.kind === "doc.insertText" && record.kind === "doc") {
          const index = Number(edit.index),
            body = unit.getBody();
          if (
            !Number.isSafeInteger(index) ||
            index < 0 ||
            index > body.dataStream.length - 2 ||
            !edit.text ||
            edit.text.length > 10000 ||
            /[\r\n]/.test(edit.text)
          )
            throw new Error(
              "Insert 1–10000 characters in one paragraph at an existing text offset.",
            );
          if (
            typeof unit.insertText !== "function" ||
            !unit.insertText(index, edit.text)
          )
            throw new Error("The document rejected the insertion.");
          return {
            region: `body:${index}`,
            summary: `Insert ${edit.text.length} characters at ${index}`,
          };
        }
        throw new Error("Unsupported bounded edit for this document kind.");
      },
      dispose: () => {
        clearTimeout(timeout);
        subscription.dispose();
        univerAPI.disposeUnit(unit.getId());
        univer.dispose();
      },
    };
  } catch (error) {
    univer.dispose();
    throw error;
  }
}
