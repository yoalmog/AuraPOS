import { Printer } from '../../types/printer.ts';
import { PrinterAdapter } from './adapters/printerAdapter.ts';
import { X18BluetoothAdapter } from './adapters/x18BluetoothAdapter.ts';
import { X18USBAdapter } from './adapters/x18UsbAdapter.ts';
import { EscPosNetworkAdapter } from './adapters/escposNetworkAdapter.ts';
import { BrowserPrintAdapter } from './adapters/browserPrintAdapter.ts';

export class PrinterManager {
  private static adapters: Map<string, PrinterAdapter> = new Map<string, PrinterAdapter>([
    ['x18_bluetooth', new X18BluetoothAdapter()],
    ['x18_usb', new X18USBAdapter()],
    ['escpos_lan', new EscPosNetworkAdapter()],
    ['browser_browser', new BrowserPrintAdapter()],
  ]);

  /**
   * Resolves the appropriate PrinterAdapter based on printer hardware & connection specs.
   * Isolates the rest of the application from underlying protocol specifics.
   */
  static getAdapter(printer: Printer): PrinterAdapter {
    const key = `${printer.printerType}_${printer.connectionType}`.toLowerCase();
    const adapter = this.adapters.get(key);

    if (adapter) {
      return adapter;
    }

    // Fallbacks
    if (printer.printerType === 'x18') {
      return this.adapters.get('x18_bluetooth')!;
    }
    if (printer.connectionType === 'lan') {
      return this.adapters.get('escpos_lan')!;
    }

    return this.adapters.get('browser_browser')!;
  }

  /**
   * Register a custom or future adapter
   */
  static registerAdapter(key: string, adapter: PrinterAdapter): void {
    this.adapters.set(key.toLowerCase(), adapter);
  }
}
