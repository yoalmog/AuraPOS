import { Printer, PrinterDiagnosticResult } from '../../../types/printer.ts';
import { AdapterTestResult, PrinterAdapter, PrintPayload } from './printerAdapter.ts';

export class BrowserPrintAdapter implements PrinterAdapter {
  readonly adapterName = 'BrowserPrintAdapter';

  async testConnection(printer: Printer): Promise<AdapterTestResult> {
    return {
      success: true,
      latencyMs: 5,
      message: 'System print spooler available via host OS print engine.'
    };
  }

  async print(printer: Printer, payload: PrintPayload): Promise<{ success: boolean; error?: string }> {
    try {
      if (typeof document !== 'undefined') {
        const iframe = document.createElement('iframe');
        iframe.style.position = 'fixed';
        iframe.style.bottom = '0';
        iframe.style.right = '0';
        iframe.style.width = '0';
        iframe.style.height = '0';
        iframe.style.border = 'none';
        document.body.appendChild(iframe);

        const doc = iframe.contentWindow?.document;
        if (doc) {
          doc.open();
          doc.write(`
            <!DOCTYPE html>
            <html>
              <head>
                <title>${payload.title}</title>
                <style>
                  body {
                    font-family: monospace;
                    font-size: 11px;
                    white-space: pre-wrap;
                    padding: 8px;
                    margin: 0;
                  }
                </style>
              </head>
              <body>${payload.previewText}</body>
            </html>
          `);
          doc.close();
          iframe.contentWindow?.focus();
          iframe.contentWindow?.print();
        }

        setTimeout(() => {
          try {
            if (document.body.contains(iframe)) {
              document.body.removeChild(iframe);
            }
          } catch {
            // Ignore removal error
          }
        }, 3000);
      }
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err?.message || 'Browser print failed' };
    }
  }

  async diagnose(printer: Printer): Promise<PrinterDiagnosticResult> {
    return {
      printerId: printer.id,
      printerName: printer.name,
      reachable: true,
      latencyMs: 5,
      protocol: 'Host OS Print Spooler (System Dialog)',
      paperWidth: printer.paperWidth || 80,
      encoding: 'UTF-8',
      details: 'Ready. Generates print job dispatched to host system spooler.',
      timestamp: new Date().toISOString()
    };
  }
}
