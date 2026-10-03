import { Printer, PrinterDiagnosticResult } from '../../../types/printer.ts';
import { AdapterTestResult, PrinterAdapter, PrintPayload } from './printerAdapter.ts';
import { BluetoothPrinterService } from '../bluetoothPrinterService.ts';
import { NativeBridgeService } from '../../native/NativeBridgeService.ts';

export class X18BluetoothAdapter implements PrinterAdapter {
  readonly adapterName = 'X18BluetoothAdapter';

  async testConnection(printer: Printer): Promise<AdapterTestResult> {
    const identifier = printer.deviceIdentifier || printer.id;

    if (NativeBridgeService.isNativeAndroid()) {
      try {
        const res = await NativeBridgeService.printer.connectBluetooth(identifier);
        return {
          success: res.success,
          message: res.success ? `Connected to ${res.name || printer.name} via native RFCOMM SPP.` : (res.error || 'Connection failed'),
          error: res.success ? undefined : 'BT_NOT_CONNECTED'
        };
      } catch (err: any) {
        return {
          success: false,
          message: err?.message || 'Bluetooth connection error',
          error: 'BT_ERROR'
        };
      }
    }

    const res = await BluetoothPrinterService.testConnection(identifier);
    return {
      success: res.success,
      latencyMs: res.latencyMs,
      message: res.message,
      error: res.success ? undefined : 'BLE_NOT_CONNECTED'
    };
  }

  async print(printer: Printer, payload: PrintPayload): Promise<{ success: boolean; error?: string }> {
    const identifier = printer.deviceIdentifier || printer.id;

    if (NativeBridgeService.isNativeAndroid()) {
      return await NativeBridgeService.printer.print('bluetooth', identifier, payload.bytes);
    }

    return await BluetoothPrinterService.printRaw(identifier, payload.bytes);
  }

  async diagnose(printer: Printer): Promise<PrinterDiagnosticResult> {
    const test = await this.testConnection(printer);
    const isNative = NativeBridgeService.isNativeAndroid();

    return {
      printerId: printer.id,
      printerName: printer.name,
      reachable: test.success,
      latencyMs: test.latencyMs,
      protocol: isNative ? 'Native Android RFCOMM SPP (X18 Mini)' : 'Web Bluetooth BLE GATT',
      paperWidth: printer.paperWidth || 58,
      encoding: printer.encoding || 'CP437',
      details: test.message,
      timestamp: new Date().toISOString()
    };
  }
}
