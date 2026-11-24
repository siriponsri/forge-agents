// Public APIs verified against published @univerjs/* 1.6.1 declarations and source.
// Only the preset for the active document kind is registered on each instance.
import { boundedSheetEdit } from "./api.mjs";
import { createProjectImageIO, imageAssets, insertProjectImage, MAX_IMAGE_BYTES, resolveSheet, snapshotWithImages } from './office-drawings.mjs';
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
  const { createUniver, LocaleType, defaultTheme, mergeLocales, IImageIoService } =
    await import("@univerjs/presets");
  let preset, locale, drawingPreset, drawingLocale, ImageIoService, UniverDrawingPlugin;
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
    const [drawing, drawingLanguage] = await Promise.all([
      import('@univerjs/preset-sheets-drawing'),
      import('@univerjs/preset-sheets-drawing/locales/en-US'),
      import('@univerjs/preset-sheets-drawing/lib/index.css'),
    ]);
    drawingPreset = drawing.UniverSheetsDrawingPreset({ allowImageSize: MAX_IMAGE_BYTES });
    drawingLocale = drawingLanguage.default;
    ImageIoService = drawing.ImageIoService;
    UniverDrawingPlugin = drawing.UniverDrawingPlugin;
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
    const [drawing, drawingLanguage] = await Promise.all([
      import('@univerjs/preset-docs-drawing'),
      import('@univerjs/preset-docs-drawing/locales/en-US'),
      import('@univerjs/preset-docs-drawing/lib/index.css'),
    ]);
    drawingPreset = drawing.UniverDocsDrawingPreset();
    drawingLocale = drawingLanguage.default;
    ImageIoService = drawing.ImageIoService;
    UniverDrawingPlugin = drawing.UniverDrawingPlugin;
  } else throw new Error("Unsupported native document kind.");
  const imageIO = createProjectImageIO(ImageIoService, {
    projectId: record.projectId,
    assets: imageAssets(record.snapshot, record.projectId),
  });
  // Configure the preset's existing drawing plugin through its public config.
  // createUniver.override only covers core dependencies; image I/O is plugin-owned.
  drawingPreset = { ...drawingPreset, plugins: drawingPreset.plugins.map(entry => {
    const [plugin, config = {}] = Array.isArray(entry) ? entry : [entry];
    return plugin === UniverDrawingPlugin ? [plugin, { ...config, allowImageSize: MAX_IMAGE_BYTES,
      override: [...(config.override || []).filter(([id]) => id !== IImageIoService),
        [IImageIoService, { useValue: imageIO }]],
    }] : entry;
  }) };
  const accent=getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()||defaultTheme.primary[500];
  const theme = {
    ...defaultTheme,
    primary: {
      ...defaultTheme.primary,
      500: accent,
      600: accent,
      700: accent,
    },
  };
  let univer, univerAPI;
  try {
    const drawingLocaleKey = record.kind === 'sheet' ? 'sheets-drawing-ui' : 'docs-drawing-ui';
    ({ univer, univerAPI } = createUniver({
      locale: LocaleType.EN_US,
      locales: { [LocaleType.EN_US]: mergeLocales(locale, drawingLocale, {
        [drawingLocaleKey]: {
          ...drawingLocale[drawingLocaleKey],
          'update-status': { ...drawingLocale[drawingLocaleKey]['update-status'],
            invalidImage: 'Image could not be uploaded. Check the PNG/JPEG file and connection, then retry.',
          },
        },
      }) },
      theme,
      presets: [preset, drawingPreset],
    }));
    const snapshot = structuredClone(
      record.snapshot || newSnapshot(record.kind, record.name),
    );
    const unit =
      record.kind === "sheet"
        ? univerAPI.createWorkbook(snapshot)
        : univerAPI.createDocument(snapshot);
    if (!unit || typeof unit.save !== "function")
      throw new Error("Native snapshot API is unavailable.");
    let timeout, disposed = false;
    const subscription = univerAPI.addEvent(
      univerAPI.Event.CommandExecuted,
      () => {
        clearTimeout(timeout);
        if (!disposed) timeout = setTimeout(onChange, 80);
      },
    );
    return {
      snapshot: () => snapshotWithImages(unit.save(), [...imageIO.assets.values()], record.projectId),
      rawSnapshot: () => snapshotWithImages(unit.save(), [...imageIO.assets.values()], record.projectId, { validate: false }),
      uploadImage: (file) => imageIO.uploadImage(file),
      insertImage: async (file, options) => {
        const result = await insertProjectImage({ io: imageIO, unit, kind: record.kind, file, options });
        if (!disposed) onChange();
        return result;
      },
      undo: () => unit.undo(),
      redo: () => unit.redo(),
      dark: (value) => {
        const color=getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()||accent;
        univerAPI.setTheme({...defaultTheme,primary:{...defaultTheme.primary,500:color,600:color,700:color}});
        univerAPI.toggleDarkMode(value);
      },
      apply: (edit) => {
        if (edit.kind === "sheet.setValues" && record.kind === "sheet") {
          const parsed = boundedSheetEdit(edit.range, edit.text);
          const sheet = resolveSheet(unit, edit.sheetId);
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
        if (disposed) return;
        disposed = true;
        clearTimeout(timeout);
        subscription.dispose();
        imageIO.dispose();
        univerAPI.disposeUnit(unit.getId());
        univer.dispose();
      },
    };
  } catch (error) {
    imageIO.dispose();
    univer?.dispose();
    throw error;
  }
}
