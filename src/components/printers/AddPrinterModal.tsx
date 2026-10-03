import React, { useState } from 'react';
import {
  Printer,
  PrinterType,
  ConnectionType,
  PaperWidthMm,
  PrinterEncoding,
  PrinterPurpose
} from '../../types/printer.ts';
import { PrintService } from '../../services/printer/printService.ts';
import { EscPosNetworkAdapter } from '../../services/printer/adapters/escposNetworkAdapter.ts';
import { X18USBAdapter } from '../../services/printer/adapters/x18UsbAdapter.ts';
import { BluetoothPrinterService } from '../../services/printer/bluetoothPrinterService.ts';
import { IframeBluetoothHelperModal } from './IframeBluetoothHelperModal.tsx';
import { usePOS } from '../../context/POSContext.tsx';
import {
  X,
  Printer as PrinterIcon,
  Wifi,
  Bluetooth,
  Monitor,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  Play,
  ArrowRight,
  Usb
} from 'lucide-react';

interface AddPrinterModalProps {
  isOpen: boolean;
  onClose: () => void;
  onPrinterAdded: (printer: Printer) => void;
  editingPrinter?: Printer | null;
}

export const AddPrinterModal: React.FC<AddPrinterModalProps> = ({
  isOpen,
  onClose,
  onPrinterAdded,
  editingPrinter
}) => {
  const { t, showToast, requireOwnerAuth } = usePOS();

  // Step 1: Add Printer Method Selection (Bluetooth / LAN / USB / System)
  // Step 2: Form Configuration & Testing
  const [step, setStep] = useState<1 | 2>(editingPrinter ? 2 : 1);
  const [selectedType, setSelectedType] = useState<PrinterType>(editingPrinter ? editingPrinter.printerType : 'x18');
  const [connectionType, setConnectionType] = useState<ConnectionType>(editingPrinter ? editingPrinter.connectionType : 'bluetooth');

  // Form Fields - No fake prefilled business/hardware data
  const [name, setName] = useState<string>(editingPrinter?.name || '');
  const [model, setModel] = useState<string>(editingPrinter?.model || '');
  const [ipAddress, setIpAddress] = useState<string>(editingPrinter?.ipAddress || '');
  const [port, setPort] = useState<number>(editingPrinter?.port || 9100);
  const [deviceIdentifier, setDeviceIdentifier] = useState<string>(editingPrinter?.deviceIdentifier || '');
  const [paperWidth, setPaperWidth] = useState<PaperWidthMm>(editingPrinter?.paperWidth || 58);
  const [charactersPerLine, setCharactersPerLine] = useState<number>(editingPrinter?.charactersPerLine || 32);
  const [encoding, setEncoding] = useState<PrinterEncoding>(editingPrinter?.encoding || 'auto');
  const [purpose, setPurpose] = useState<PrinterPurpose>(editingPrinter?.printerPurpose || 'receipt');
  const [autoPrint, setAutoPrint] = useState<boolean>(editingPrinter?.autoPrint ?? true);
  const [supportsCut, setSupportsCut] = useState<boolean>(editingPrinter?.supportsCut ?? false);
  const [supportsCashDrawer, setSupportsCashDrawer] = useState<boolean>(editingPrinter?.supportsCashDrawer ?? false);
  const [supportsQr, setSupportsQr] = useState<boolean>(editingPrinter?.supportsQr ?? true);
  const [supportsBarcode, setSupportsBarcode] = useState<boolean>(editingPrinter?.supportsBarcode ?? true);
  const [isDefault, setIsDefault] = useState<boolean>(editingPrinter?.isDefault ?? false);

  // Status & discovery states
  const [isSearchingBluetooth, setIsSearchingBluetooth] = useState(false);
  const [isSearchingUsb, setIsSearchingUsb] = useState(false);
  const [verificationNotice, setVerificationNotice] = useState<string | null>(null);

  // Testing feedback states
  const [isTestingConn, setIsTestingConn] = useState(false);
  const [connTestResult, setConnTestResult] = useState<{ success: boolean; message: string; latency?: number } | null>(null);
  const [isTestPrinting, setIsTestPrinting] = useState(false);
  const [printTestResult, setPrintTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [isIframeHelperOpen, setIsIframeHelperOpen] = useState(false);

  if (!isOpen) return null;

  // Option 1: Scan Bluetooth Printers (Real discovery & capability verification)
  const handleScanBluetooth = async () => {
    setIsSearchingBluetooth(true);
    setVerificationNotice(null);
    setConnTestResult(null);

    try {
      const res = await BluetoothPrinterService.scanAndPair();
      if (res.success && res.printer) {
        setName(res.printer.name);
        setDeviceIdentifier(res.printer.id);
        setModel(res.printer.protocol || 'ESC/POS Bluetooth Thermal');
        setConnectionType('bluetooth');
        setSelectedType('x18');
        setPaperWidth(res.printer.paperWidth || 58);
        setCharactersPerLine(res.printer.paperWidth === 80 ? 48 : 32);
        setSupportsCut(false); // Mobile BLE printers have manual tear
        setSupportsCashDrawer(false);
        setStep(2);

        setVerificationNotice(`Hardware capability verified: ${res.printer.protocol}. GATT channel established.`);
        setConnTestResult({
          success: true,
          message: `Paired and verified active connection with "${res.printer.name}".`
        });

        showToast({
          type: 'success',
          title: t('printers.bluetoothPaired', 'Bluetooth Printer Paired'),
          message: `${res.printer.name} verified and ready.`
        });
      } else if (res.isSecurityBlocked) {
        setIsIframeHelperOpen(true);
      } else if (res.error) {
        showToast({
          type: 'warning',
          title: t('printers.scanNotice', 'Bluetooth Scan Notice'),
          message: res.error
        });
      }
    } catch (err: any) {
      showToast({
        type: 'error',
        title: 'Bluetooth Scan Error',
        message: err.message || 'Bluetooth connection failed.'
      });
    } finally {
      setIsSearchingBluetooth(false);
    }
  };

  // Option 2: Add LAN / Network Printer
  const handleSelectLan = () => {
    setSelectedType('escpos');
    setConnectionType('lan');
    setName('');
    setModel('Generic ESC/POS Network Printer');
    setPort(9100);
    setPaperWidth(80);
    setCharactersPerLine(48);
    setSupportsCut(true);
    setSupportsCashDrawer(true);
    setPurpose('receipt');
    setVerificationNotice(null);
    setConnTestResult(null);
    setStep(2);
  };

  // Option 3: Add USB Printer (Real WebUSB discovery)
  const handleScanUsb = async () => {
    setIsSearchingUsb(true);
    setVerificationNotice(null);
    setConnTestResult(null);

    try {
      const res = await X18USBAdapter.requestUsbPrinter();
      if (res.success && res.printer) {
        setName(res.printer.name);
        setDeviceIdentifier(res.printer.id);
        setModel('USB Thermal ESC/POS');
        setConnectionType('usb');
        setSelectedType('usb');
        setPaperWidth(58);
        setCharactersPerLine(32);
        setStep(2);

        setVerificationNotice(`USB endpoint claimed: ${res.printer.name}`);
        setConnTestResult({
          success: true,
          message: `USB printer connected and claimed interface.`
        });

        showToast({
          type: 'success',
          title: 'USB Printer Connected',
          message: `${res.printer.name} paired successfully.`
        });
      } else if (res.error) {
        showToast({
          type: 'warning',
          title: 'USB Discovery Notice',
          message: res.error
        });
      }
    } catch (err: any) {
      showToast({
        type: 'error',
        title: 'USB Connection Error',
        message: err.message || 'USB discovery failed.'
      });
    } finally {
      setIsSearchingUsb(false);
    }
  };

  // Option 4: Add System Printer (Browser Print Spooler)
  const handleSelectBrowser = () => {
    setSelectedType('browser');
    setConnectionType('browser');
    setName(t('printers.systemPrinterName', 'Host OS Print Spooler'));
    setModel('Operating System Print Spooler');
    setPaperWidth(80);
    setCharactersPerLine(48);
    setSupportsCut(false);
    setSupportsCashDrawer(false);
    setPurpose('report');
    setVerificationNotice('Uses system OS printer drivers and print dialogue.');
    setConnTestResult({
      success: true,
      message: 'System print spooler available.'
    });
    setStep(2);
  };

  const handlePaperWidthChange = (w: PaperWidthMm) => {
    setPaperWidth(w);
    if (w === 58) {
      setCharactersPerLine(32);
    } else if (w === 80) {
      setCharactersPerLine(48);
    } else {
      setCharactersPerLine(42);
    }
  };

  // Real Test Connection Handler
  const handleTestConnection = async () => {
    setIsTestingConn(true);
    setConnTestResult(null);

    const tempPrinter: Printer = {
      id: editingPrinter?.id || 'temp_test',
      storeId: 'store_aura_main',
      name: name.trim() || 'Unsaved Printer',
      model: model || 'Thermal Printer',
      printerType: selectedType,
      connectionType,
      ipAddress: connectionType === 'lan' ? ipAddress.trim() : undefined,
      port: connectionType === 'lan' ? port : undefined,
      deviceIdentifier: connectionType === 'bluetooth' || connectionType === 'usb' ? deviceIdentifier.trim() : undefined,
      paperWidth,
      charactersPerLine,
      encoding,
      isDefault,
      printerPurpose: purpose,
      autoPrint,
      supportsCut,
      supportsCashDrawer,
      supportsQr,
      supportsBarcode,
      status: 'unknown',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    if (connectionType === 'lan') {
      const adapter = new EscPosNetworkAdapter();
      const res = await adapter.testConnection(tempPrinter);
      setConnTestResult({
        success: res.success,
        message: res.message,
        latency: res.latencyMs
      });
    } else if (connectionType === 'bluetooth') {
      const res = await BluetoothPrinterService.testConnection(deviceIdentifier || 'temp');
      setConnTestResult({
        success: res.success,
        message: res.message,
        latency: res.latencyMs
      });
    } else if (connectionType === 'usb') {
      const adapter = new X18USBAdapter();
      const res = await adapter.testConnection(tempPrinter);
      setConnTestResult({
        success: res.success,
        message: res.message,
        latency: res.latencyMs
      });
    } else {
      setConnTestResult({
        success: true,
        message: 'System print spooler ready.'
      });
    }
    setIsTestingConn(false);
  };

  // Real Test Print Handler
  const handleTestPrint = async () => {
    setIsTestPrinting(true);
    setPrintTestResult(null);

    const tempPrinter: Printer = {
      id: editingPrinter?.id || `prn_test_${Date.now()}`,
      storeId: 'store_aura_main',
      name: name.trim() || 'Test Printer',
      model: model || 'Thermal Printer',
      printerType: selectedType,
      connectionType,
      ipAddress: connectionType === 'lan' ? ipAddress.trim() : undefined,
      port: connectionType === 'lan' ? port : undefined,
      deviceIdentifier: connectionType === 'bluetooth' || connectionType === 'usb' ? deviceIdentifier.trim() : undefined,
      paperWidth,
      charactersPerLine,
      encoding,
      isDefault,
      printerPurpose: purpose,
      autoPrint,
      supportsCut,
      supportsCashDrawer,
      supportsQr,
      supportsBarcode,
      status: connTestResult?.success ? 'connected' : 'disconnected',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    // Save temporary record so spooler can resolve it
    PrintService.savePrinter(tempPrinter);
    const res = await PrintService.testPrint(tempPrinter.id);
    setPrintTestResult({
      success: res.success,
      message: res.message
    });
    setIsTestPrinting(false);
  };

  const handleSavePrinter = (e: React.FormEvent) => {
    e.preventDefault();

    if (!name.trim()) {
      showToast({ type: 'warning', title: 'Printer name is required' });
      return;
    }

    if (connectionType === 'lan' && !ipAddress.trim()) {
      showToast({ type: 'warning', title: 'IP address is required for LAN printer' });
      return;
    }

    requireOwnerAuth(() => {
      const printerToSave: Printer = {
        id: editingPrinter?.id || `prn_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
        storeId: 'store_aura_main',
        name: name.trim(),
        model: model || `${connectionType.toUpperCase()} Printer`,
        printerType: selectedType,
        connectionType,
        ipAddress: connectionType === 'lan' ? ipAddress.trim() : undefined,
        port: connectionType === 'lan' ? port : undefined,
        deviceIdentifier: connectionType === 'bluetooth' || connectionType === 'usb' ? deviceIdentifier.trim() : undefined,
        paperWidth,
        charactersPerLine: Number(charactersPerLine) || (paperWidth === 58 ? 32 : 48),
        encoding,
        isDefault,
        printerPurpose: purpose,
        autoPrint,
        supportsCut,
        supportsCashDrawer,
        supportsQr,
        supportsBarcode,
        status: connTestResult?.success ? 'connected' : 'disconnected',
        createdAt: editingPrinter?.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      PrintService.savePrinter(printerToSave);
      onPrinterAdded(printerToSave);
      onClose();

      showToast({
        type: 'success',
        title: editingPrinter ? 'Printer Updated' : 'Printer Added',
        message: `${printerToSave.name} configuration saved.`
      });
    }, 'Save Hardware Printer Configuration');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-xs overflow-y-auto">
      <div className="bg-white rounded-3xl max-w-xl w-full overflow-hidden shadow-2xl border border-slate-200 my-8 flex flex-col max-h-[92vh]">
        {/* Modal Header */}
        <div className="px-6 py-4.5 bg-slate-900 text-white flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-blue-600/30 text-blue-400">
              <PrinterIcon className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-base">
                {editingPrinter ? t('printers.editPrinter', 'Edit Hardware Printer') : t('printers.addPrinter', 'Add Hardware Printer')}
              </h3>
              <p className="text-xs text-slate-400">
                {step === 1
                  ? t('printers.selectMethod', 'Select hardware connection method')
                  : t('printers.configureSettings', 'Configure printer connection & test hardware')}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* STEP 1: METHOD SELECTION (Section 4 & 5) */}
        {step === 1 && (
          <div className="p-6 space-y-4 overflow-y-auto">
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400">
              {t('printers.chooseMethod', 'Select Printer Interface')}
            </h4>

            <div className="grid grid-cols-1 gap-3">
              {/* Option 1: Scan Bluetooth Printers */}
              <button
                type="button"
                disabled={isSearchingBluetooth}
                onClick={handleScanBluetooth}
                className="flex items-start gap-4 p-4 rounded-2xl border border-slate-200 hover:border-indigo-500 hover:bg-indigo-50/40 text-left transition-all group cursor-pointer disabled:opacity-60"
              >
                <div className="w-12 h-12 rounded-2xl bg-indigo-50 border border-indigo-200 flex items-center justify-center text-indigo-600 shrink-0 group-hover:scale-105 transition-transform">
                  <Bluetooth className={`w-6 h-6 ${isSearchingBluetooth ? 'animate-spin' : ''}`} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h5 className="text-sm font-bold text-slate-900 group-hover:text-indigo-600">
                      {isSearchingBluetooth ? 'Scanning for Bluetooth Devices...' : 'Scan Bluetooth Printers'}
                    </h5>
                    <span className="text-[10px] font-bold bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full">
                      Wireless BLE
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 mt-1">
                    Direct OS device scan for Bluetooth ESC/POS printers (X18 Mini, POS-58, MPT-II). Connects via GATT with capability verification.
                  </p>
                </div>
                <ArrowRight className="w-5 h-5 text-slate-300 group-hover:text-indigo-600 transition-colors shrink-0 self-center" />
              </button>

              {/* Option 2: Add LAN / Network Printer */}
              <button
                type="button"
                onClick={handleSelectLan}
                className="flex items-start gap-4 p-4 rounded-2xl border border-slate-200 hover:border-emerald-500 hover:bg-emerald-50/40 text-left transition-all group cursor-pointer"
              >
                <div className="w-12 h-12 rounded-2xl bg-emerald-50 border border-emerald-200 flex items-center justify-center text-emerald-600 shrink-0 group-hover:scale-105 transition-transform">
                  <Wifi className="w-6 h-6" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h5 className="text-sm font-bold text-slate-900 group-hover:text-emerald-700">
                      Add LAN / Network Printer
                    </h5>
                    <span className="text-[10px] font-bold bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded-full">
                      TCP 9100 / Ethernet
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 mt-1">
                    Connect to a local network thermal printer by IP address and TCP port 9100 (Kitchen, Barista, Front Counter).
                  </p>
                </div>
                <ArrowRight className="w-5 h-5 text-slate-300 group-hover:text-emerald-600 transition-colors shrink-0 self-center" />
              </button>

              {/* Option 3: Add USB Printer */}
              <button
                type="button"
                disabled={isSearchingUsb}
                onClick={handleScanUsb}
                className="flex items-start gap-4 p-4 rounded-2xl border border-slate-200 hover:border-amber-500 hover:bg-amber-50/40 text-left transition-all group cursor-pointer disabled:opacity-60"
              >
                <div className="w-12 h-12 rounded-2xl bg-amber-50 border border-amber-200 flex items-center justify-center text-amber-600 shrink-0 group-hover:scale-105 transition-transform">
                  <Usb className={`w-6 h-6 ${isSearchingUsb ? 'animate-spin' : ''}`} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h5 className="text-sm font-bold text-slate-900 group-hover:text-amber-700">
                      {isSearchingUsb ? 'Requesting USB Device...' : 'Add USB Printer'}
                    </h5>
                    <span className="text-[10px] font-bold bg-amber-100 text-amber-800 px-2 py-0.5 rounded-full">
                      WebUSB / Cable
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 mt-1">
                    Connect a USB thermal printer directly via USB-C or OTG cable using the browser WebUSB interface.
                  </p>
                </div>
                <ArrowRight className="w-5 h-5 text-slate-300 group-hover:text-amber-600 transition-colors shrink-0 self-center" />
              </button>

              {/* Option 4: Add System Printer */}
              <button
                type="button"
                onClick={handleSelectBrowser}
                className="flex items-start gap-4 p-4 rounded-2xl border border-slate-200 hover:border-blue-500 hover:bg-blue-50/40 text-left transition-all group cursor-pointer"
              >
                <div className="w-12 h-12 rounded-2xl bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-600 shrink-0 group-hover:scale-105 transition-transform">
                  <Monitor className="w-6 h-6" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h5 className="text-sm font-bold text-slate-900 group-hover:text-blue-600">
                      Add System Printer
                    </h5>
                    <span className="text-[10px] font-bold bg-slate-200 text-slate-700 px-2 py-0.5 rounded-full">
                      OS Spooler
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 mt-1">
                    Routes print jobs through your host operating system print dialogue, PDF export, or installed desktop drivers.
                  </p>
                </div>
                <ArrowRight className="w-5 h-5 text-slate-300 group-hover:text-blue-600 transition-colors shrink-0 self-center" />
              </button>
            </div>
          </div>
        )}

        {/* STEP 2: PRINTER CONFIGURATION & CONNECTION TESTING */}
        {step === 2 && (
          <form onSubmit={handleSavePrinter} className="flex-1 overflow-y-auto p-6 space-y-4 text-xs">
            {!editingPrinter && (
              <button
                type="button"
                onClick={() => setStep(1)}
                className="text-xs text-blue-600 hover:underline mb-1 flex items-center gap-1 font-semibold cursor-pointer"
              >
                ← {t('printers.changeType', 'Change Printer Method / Search Again')}
              </button>
            )}

            {verificationNotice && (
              <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-900 rounded-xl flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                <span className="text-xs font-medium">{verificationNotice}</span>
              </div>
            )}

            {/* Basic Identity */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  {t('printers.displayName', 'Printer Display Name')} *
                </label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="e.g. Counter Receipt Printer"
                  className="w-full p-2.5 bg-slate-50 rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-blue-500 font-medium"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  {t('printers.hardwareModel', 'Hardware Model / Protocol')}
                </label>
                <input
                  type="text"
                  value={model}
                  onChange={e => setModel(e.target.value)}
                  placeholder="e.g. X18 Mini Portable / ESC/POS"
                  className="w-full p-2.5 bg-slate-50 rounded-xl border border-slate-300 font-medium"
                />
              </div>
            </div>

            {/* Connection Specs */}
            {connectionType === 'lan' && (
              <div className="grid grid-cols-3 gap-3 p-3.5 bg-slate-50 rounded-xl border border-slate-200">
                <div className="col-span-2">
                  <label className="block font-semibold text-slate-700 mb-1">
                    {t('printers.lanIp', 'LAN IP Address')} *
                  </label>
                  <input
                    type="text"
                    required
                    value={ipAddress}
                    onChange={e => setIpAddress(e.target.value)}
                    placeholder="e.g. 192.168.1.150"
                    className="w-full p-2 bg-white rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    {t('printers.port', 'Port')}
                  </label>
                  <input
                    type="number"
                    required
                    value={port}
                    onChange={e => setPort(parseInt(e.target.value, 10) || 9100)}
                    className="w-full p-2 bg-white rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
                  />
                </div>
              </div>
            )}

            {(connectionType === 'bluetooth' || connectionType === 'usb') && (
              <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200 space-y-2">
                <div className="flex items-center justify-between">
                  <label className="block font-semibold text-slate-700">
                    Device Identifier (Platform UUID / Serial)
                  </label>
                  {connectionType === 'bluetooth' && (
                    <button
                      type="button"
                      onClick={handleScanBluetooth}
                      className="text-xs text-blue-600 hover:underline font-bold flex items-center gap-1 cursor-pointer"
                    >
                      <Bluetooth className="w-3.5 h-3.5" />
                      <span>Re-Scan Device</span>
                    </button>
                  )}
                </div>
                <input
                  type="text"
                  value={deviceIdentifier}
                  onChange={e => setDeviceIdentifier(e.target.value)}
                  placeholder="Platform-provided hardware ID"
                  className="w-full p-2 bg-white rounded-lg border border-slate-300 focus:outline-none font-mono text-slate-700"
                />
              </div>
            )}

            {/* Paper Width & Columns */}
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  {t('printers.paperWidth', 'Paper Width')}
                </label>
                <div className="flex gap-1.5">
                  {[58, 80, 76].map(w => (
                    <button
                      key={w}
                      type="button"
                      onClick={() => handlePaperWidthChange(w as PaperWidthMm)}
                      className={`flex-1 py-2 text-center rounded-lg border font-mono font-semibold cursor-pointer ${
                        paperWidth === w
                          ? 'border-blue-600 bg-blue-50 text-blue-700 font-bold'
                          : 'border-slate-300 bg-white text-slate-600'
                      }`}
                    >
                      {w}mm
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  {t('printers.charPerLine', 'Characters Per Line')}
                </label>
                <input
                  type="number"
                  required
                  value={charactersPerLine}
                  onChange={e => setCharactersPerLine(parseInt(e.target.value, 10))}
                  className="w-full p-2 bg-slate-50 rounded-lg border border-slate-300 font-mono"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  {t('printers.encoding', 'Encoding')}
                </label>
                <select
                  value={encoding}
                  onChange={e => setEncoding(e.target.value as any)}
                  className="w-full p-2 bg-slate-50 rounded-lg border border-slate-300 font-medium"
                >
                  <option value="auto">Auto-detect</option>
                  <option value="UTF-8">UTF-8</option>
                  <option value="CP437">CP437 (Standard)</option>
                  <option value="CP850">CP850 (Multilingual)</option>
                  <option value="Windows-1252">Windows-1252</option>
                </select>
              </div>
            </div>

            {/* Purpose & Defaulting */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  {t('printers.purpose', 'Primary Purpose')}
                </label>
                <select
                  value={purpose}
                  onChange={e => setPurpose(e.target.value as any)}
                  className="w-full p-2 bg-slate-50 rounded-xl border border-slate-300 font-semibold text-slate-800"
                >
                  <option value="receipt">Customer Receipt Printer</option>
                  <option value="kitchen">Kitchen Order Station</option>
                  <option value="bar">Barista / Drink Station</option>
                  <option value="label">Adhesive Labels</option>
                  <option value="report">End of Day Reports</option>
                  <option value="all">Universal (All Jobs)</option>
                </select>
              </div>

              <div className="flex items-center pt-5">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={isDefault}
                    onChange={e => setIsDefault(e.target.checked)}
                    className="w-4 h-4 rounded text-blue-600 focus:ring-blue-500"
                  />
                  <span className="font-semibold text-slate-800">
                    {t('printers.setAsDefault', 'Set as default printer')}
                  </span>
                </label>
              </div>
            </div>

            {/* Physical Capabilities Toggle */}
            <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 space-y-2">
              <span className="text-[11px] font-bold text-slate-600 uppercase tracking-wider block">
                Hardware Capabilities (Only enable verified features)
              </span>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={supportsCut}
                    onChange={e => setSupportsCut(e.target.checked)}
                  />
                  <span className="text-slate-700">Auto Paper Cut</span>
                </label>
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={supportsCashDrawer}
                    onChange={e => setSupportsCashDrawer(e.target.checked)}
                  />
                  <span className="text-slate-700">Kick Cash Drawer</span>
                </label>
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={supportsQr}
                    onChange={e => setSupportsQr(e.target.checked)}
                  />
                  <span className="text-slate-700">QR Code Printing</span>
                </label>
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={supportsBarcode}
                    onChange={e => setSupportsBarcode(e.target.checked)}
                  />
                  <span className="text-slate-700">Barcode Printing</span>
                </label>
              </div>
            </div>

            {/* Real Hardware Connection Test & Test Print */}
            <div className="p-3.5 bg-blue-50/60 rounded-xl border border-blue-200 space-y-3">
              <div className="flex items-center justify-between">
                <span className="font-bold text-blue-900 text-xs flex items-center gap-1.5">
                  <RefreshCw className="w-3.5 h-3.5 text-blue-600" />
                  <span>Hardware Testing (Real Verification)</span>
                </span>
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={isTestingConn}
                    onClick={handleTestConnection}
                    className="px-3 py-1.5 bg-white hover:bg-slate-50 text-blue-700 border border-blue-300 font-bold rounded-lg text-xs flex items-center gap-1 cursor-pointer disabled:opacity-50"
                  >
                    <RefreshCw className={`w-3 h-3 ${isTestingConn ? 'animate-spin' : ''}`} />
                    <span>{isTestingConn ? 'Testing...' : 'Test Connection'}</span>
                  </button>

                  <button
                    type="button"
                    disabled={isTestPrinting}
                    onClick={handleTestPrint}
                    className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-lg text-xs flex items-center gap-1 cursor-pointer disabled:opacity-50"
                  >
                    <Play className="w-3 h-3" />
                    <span>{isTestPrinting ? 'Printing...' : 'Test Print'}</span>
                  </button>
                </div>
              </div>

              {connTestResult && (
                <div
                  className={`p-2.5 rounded-lg text-xs flex items-center gap-2 ${
                    connTestResult.success
                      ? 'bg-emerald-100 text-emerald-900 border border-emerald-300'
                      : 'bg-rose-100 text-rose-900 border border-rose-300'
                  }`}
                >
                  {connTestResult.success ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                  ) : (
                    <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                  )}
                  <span>{connTestResult.message}</span>
                </div>
              )}

              {printTestResult && (
                <div
                  className={`p-2.5 rounded-lg text-xs flex items-center gap-2 ${
                    printTestResult.success
                      ? 'bg-emerald-100 text-emerald-900 border border-emerald-300'
                      : 'bg-rose-100 text-rose-900 border border-rose-300'
                  }`}
                >
                  {printTestResult.success ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                  ) : (
                    <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                  )}
                  <span>{printTestResult.message}</span>
                </div>
              )}
            </div>

            {/* Form Action Buttons */}
            <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-200">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-slate-600 hover:bg-slate-100 font-semibold rounded-xl cursor-pointer"
              >
                {t('common.cancel', 'Cancel')}
              </button>
              <button
                type="submit"
                className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl shadow-xs cursor-pointer"
              >
                {editingPrinter ? t('common.saveChanges', 'Save Changes') : t('printers.savePrinter', 'Save Printer')}
              </button>
            </div>
          </form>
        )}
      </div>

      {/* Iframe Bluetooth Security Helper Modal */}
      <IframeBluetoothHelperModal
        isOpen={isIframeHelperOpen}
        onClose={() => setIsIframeHelperOpen(false)}
        onSelectLan={() => {
          setIsIframeHelperOpen(false);
          handleSelectLan();
        }}
      />
    </div>
  );
};
