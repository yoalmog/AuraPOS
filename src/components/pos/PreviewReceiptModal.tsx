import React, { useState, useEffect, useMemo } from 'react';
import { Sale } from '../../types/pos.ts';
import { Printer } from '../../types/printer.ts';
import { usePOS } from '../../context/POSContext.tsx';
import { PrinterService } from '../../services/PrinterService.ts';
import { EscPosGenerator } from '../../utils/EscPosGenerator.ts';
import {
  Printer as PrinterIcon,
  Download,
  X,
  Eye,
  Check,
  FileText,
  Sliders,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  Clock,
  Receipt,
  Sparkles
} from 'lucide-react';

interface PreviewReceiptModalProps {
  isOpen: boolean;
  onClose: () => void;
  sale: Sale;
  onConfirmPaymentAndPrint?: () => void;
}

export const PreviewReceiptModal: React.FC<PreviewReceiptModalProps> = ({
  isOpen,
  onClose,
  sale,
  onConfirmPaymentAndPrint
}) => {
  const {
    settings,
    showToast,
    formatCurrency,
    formatDate,
    formatTime,
    translateProductName,
    t
  } = usePOS();

  // View state: 'thermal' (visual thermal paper) or 'escpos' (raw monospace text simulation)
  const [viewMode, setViewMode] = useState<'thermal' | 'escpos'>('thermal');
  // Paper width simulation: 80mm (48 characters) or 58mm (32 characters)
  const [paperWidth, setPaperWidth] = useState<80 | 58>(80);

  const [availablePrinters, setAvailablePrinters] = useState<Printer[]>([]);
  const [selectedPrinterId, setSelectedPrinterId] = useState<string>('');
  const [isPrinting, setIsPrinting] = useState<boolean>(false);
  const [printStatusMessage, setPrintStatusMessage] = useState<{
    type: 'success' | 'error' | 'info';
    text: string;
  } | null>(null);

  useEffect(() => {
    if (isOpen) {
      const list = PrinterService.getPrinters();
      setAvailablePrinters(list);
      const defaultPrinter = list.find(p => p.isDefault || p.printerPurpose === 'receipt') || list[0];
      if (defaultPrinter) {
        setSelectedPrinterId(defaultPrinter.id);
        if (defaultPrinter.paperWidth === 58 || defaultPrinter.paperWidth === 80) {
          setPaperWidth(defaultPrinter.paperWidth);
        }
      }
      setPrintStatusMessage(null);
    }
  }, [isOpen]);

  // Generate simulated ESC/POS raw text representation for Monospace view
  const escposText = useMemo(() => {
    const cols = paperWidth === 58 ? 32 : 48;
    const gen = new EscPosGenerator(cols);

    gen
      .initialize()
      .setAlignment('center')
      .setBold(true)
      .line(settings.name || 'AURA POS')
      .setBold(false);

    if (settings.address) gen.line(settings.address);
    if (settings.phone) gen.line(`Tel: ${settings.phone}`);
    if (settings.taxId) gen.line(`Tax ID: ${settings.taxId}`);
    if (settings.receiptHeader) gen.line(settings.receiptHeader);

    gen
      .doubleSeparator('=')
      .setAlignment('left')
      .line(`RECEIPT: #${sale.receiptNumber}`)
      .line(`DATE:    ${formatDate(sale.createdAt)} ${formatTime(sale.createdAt)}`)
      .line(`CASHIER: ${sale.employeeName}`);

    if (sale.customerName) {
      gen.line(`CLIENT:  ${sale.customerName}`);
    }

    gen.separator('-');

    const qtyColWidth = 4;
    const priceColWidth = 8;
    const itemColWidth = Math.max(8, cols - qtyColWidth - priceColWidth);

    gen.columns([
      { text: 'ITEM', width: itemColWidth, align: 'left' },
      { text: 'QTY', width: qtyColWidth, align: 'right' },
      { text: 'TOTAL', width: priceColWidth, align: 'right' }
    ]);
    gen.separator('-');

    for (const item of sale.items) {
      const name = translateProductName(item.productId, item.productName);
      const priceStr = formatCurrency(item.unitPrice * item.quantity);
      gen.columns([
        { text: name, width: itemColWidth, align: 'left' },
        { text: `${item.quantity}x`, width: qtyColWidth, align: 'right' },
        { text: priceStr, width: priceColWidth, align: 'right' }
      ]);
      if (item.variantName) {
        gen.line(`  (${item.variantName})`);
      }
    }

    gen.separator('-');
    gen.columns([
      { text: 'SUBTOTAL', width: cols - 10, align: 'left' },
      { text: formatCurrency(sale.subtotal), width: 10, align: 'right' }
    ]);

    if (sale.discountAmount > 0) {
      gen.columns([
        { text: 'DISCOUNT', width: cols - 10, align: 'left' },
        { text: `-${formatCurrency(sale.discountAmount)}`, width: 10, align: 'right' }
      ]);
    }

    gen.columns([
      { text: `TAX (${(sale.taxRate * 100).toFixed(1)}%)`, width: cols - 10, align: 'left' },
      { text: formatCurrency(sale.taxAmount), width: 10, align: 'right' }
    ]);

    gen.doubleSeparator('=');
    gen.setBold(true);
    gen.columns([
      { text: 'TOTAL DUE', width: cols - 12, align: 'left' },
      { text: formatCurrency(sale.total), width: 12, align: 'right' }
    ]);
    gen.setBold(false);
    gen.separator('-');

    // Payments
    for (const p of sale.payments) {
      gen.columns([
        { text: `PAYMENT (${p.method.toUpperCase()})`, width: cols - 12, align: 'left' },
        { text: formatCurrency(p.amount), width: 12, align: 'right' }
      ]);
      if (p.tendered !== undefined && p.tendered > 0) {
        gen.columns([
          { text: 'TENDERED', width: cols - 12, align: 'left' },
          { text: formatCurrency(p.tendered), width: 12, align: 'right' }
        ]);
      }
      if (p.change !== undefined && p.change > 0) {
        gen.columns([
          { text: 'CHANGE', width: cols - 12, align: 'left' },
          { text: formatCurrency(p.change), width: 12, align: 'right' }
        ]);
      }
    }

    if (sale.notes) {
      gen.separator('-');
      gen.line(`NOTES: ${sale.notes}`);
    }

    gen
      .doubleSeparator('=')
      .setAlignment('center')
      .line(settings.receiptFooter || 'Thank you for your business!')
      .line('*** PREVIEW COPY ***');

    return gen.toPreviewText();
  }, [sale, paperWidth, settings, formatDate, formatTime, formatCurrency, translateProductName]);

  if (!isOpen) return null;

  // Handle physical print execution
  const handlePrint = async () => {
    setIsPrinting(true);
    setPrintStatusMessage(null);

    try {
      const res = await PrinterService.printReceipt(sale, {
        printerId: selectedPrinterId || undefined
      });

      if (res.success) {
        setPrintStatusMessage({
          type: 'success',
          text: t('toasts.receiptDispatched', 'Receipt successfully transmitted to printer.')
        });
        showToast({
          type: 'success',
          title: t('toasts.printSuccess', 'Receipt Printed'),
          message: 'Physical receipt sent to hardware printer.'
        });
      } else {
        setPrintStatusMessage({
          type: 'error',
          text: res.error || 'Configured printer offline or unreachable.'
        });
        showToast({
          type: 'warning',
          title: 'Print Unsuccessful',
          message: res.error || 'Could not reach target printer.'
        });
      }
    } catch (err: any) {
      setPrintStatusMessage({
        type: 'error',
        text: err?.message || 'Printer communication error.'
      });
    } finally {
      setIsPrinting(false);
    }
  };

  // Download formatted text file
  const handleDownload = () => {
    const blob = new Blob([escposText], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `Receipt_Preview_${sale.receiptNumber}.txt`;
    link.click();
    URL.revokeObjectURL(url);
    showToast({
      type: 'success',
      title: 'Receipt Downloaded',
      message: 'Saved plain-text receipt file.'
    });
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-3 sm:p-5 select-none animate-fadeIn">
      <div className="bg-white dark:bg-slate-900 rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-800 w-full max-w-2xl max-h-[92vh] flex flex-col overflow-hidden">
        {/* Modal Header */}
        <div className="px-5 py-4 bg-slate-900 text-white flex items-center justify-between border-b border-slate-800 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-blue-600/30 border border-blue-500/40 flex items-center justify-center text-blue-400">
              <Receipt className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-bold text-base tracking-tight text-white">
                  {t('receipt.previewTitle', 'Preview Receipt')}
                </h3>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-blue-500/20 text-blue-300 border border-blue-400/30">
                  #{sale.receiptNumber}
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Inspect physical thermal formatting and paper line-wrap before printing
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white flex items-center justify-center transition-colors cursor-pointer"
            aria-label="Close preview modal"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Configuration Bar: Paper Width & Format Controls */}
        <div className="px-5 py-2.5 bg-slate-100 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3 text-xs shrink-0">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-slate-600 dark:text-slate-300 text-[11px]">
              Paper Width:
            </span>
            <div className="inline-flex rounded-lg bg-slate-200 dark:bg-slate-700 p-0.5">
              <button
                type="button"
                onClick={() => setPaperWidth(80)}
                className={`px-2.5 py-1 rounded-md text-xs font-semibold transition-all cursor-pointer ${
                  paperWidth === 80
                    ? 'bg-white dark:bg-slate-900 text-blue-600 dark:text-blue-400 shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
                }`}
              >
                80mm (Standard)
              </button>
              <button
                type="button"
                onClick={() => setPaperWidth(58)}
                className={`px-2.5 py-1 rounded-md text-xs font-semibold transition-all cursor-pointer ${
                  paperWidth === 58
                    ? 'bg-white dark:bg-slate-900 text-blue-600 dark:text-blue-400 shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
                }`}
              >
                58mm (Compact)
              </button>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span className="font-semibold text-slate-600 dark:text-slate-300 text-[11px]">
              View Mode:
            </span>
            <div className="inline-flex rounded-lg bg-slate-200 dark:bg-slate-700 p-0.5">
              <button
                type="button"
                onClick={() => setViewMode('thermal')}
                className={`px-2.5 py-1 rounded-md text-xs font-semibold transition-all cursor-pointer ${
                  viewMode === 'thermal'
                    ? 'bg-white dark:bg-slate-900 text-blue-600 dark:text-blue-400 shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
                }`}
              >
                Thermal Paper
              </button>
              <button
                type="button"
                onClick={() => setViewMode('escpos')}
                className={`px-2.5 py-1 rounded-md text-xs font-semibold transition-all cursor-pointer ${
                  viewMode === 'escpos'
                    ? 'bg-white dark:bg-slate-900 text-blue-600 dark:text-blue-400 shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
                }`}
              >
                ESC/POS Text
              </button>
            </div>
          </div>
        </div>

        {/* Status Notification Banner (if any) */}
        {printStatusMessage && (
          <div
            className={`px-5 py-2.5 text-xs flex items-center justify-between border-b ${
              printStatusMessage.type === 'success'
                ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-200 border-emerald-200 dark:border-emerald-800'
                : printStatusMessage.type === 'error'
                ? 'bg-rose-50 dark:bg-rose-950/40 text-rose-800 dark:text-rose-200 border-rose-200 dark:border-rose-800'
                : 'bg-blue-50 dark:bg-blue-950/40 text-blue-800 dark:text-blue-200 border-blue-200 dark:border-blue-800'
            }`}
          >
            <div className="flex items-center gap-2">
              {printStatusMessage.type === 'success' ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              ) : printStatusMessage.type === 'error' ? (
                <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
              ) : (
                <Clock className="w-4 h-4 text-blue-600 shrink-0" />
              )}
              <span>{printStatusMessage.text}</span>
            </div>
            <button
              type="button"
              onClick={() => setPrintStatusMessage(null)}
              className="text-slate-400 hover:text-slate-600 text-xs cursor-pointer"
            >
              ✕
            </button>
          </div>
        )}

        {/* Receipt View Body */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 bg-slate-100 dark:bg-slate-950 flex justify-center items-start">
          {viewMode === 'thermal' ? (
            /* Thermal Paper Simulation Card */
            <div
              style={{
                width: paperWidth === 58 ? '300px' : '380px'
              }}
              className="bg-white text-slate-900 p-6 rounded-sm shadow-xl border-t-8 border-b-8 border-slate-300 font-mono text-xs transition-all duration-200 relative select-text"
            >
              {/* Paper Top Jagged/Serrated Effect */}
              <div className="absolute top-0 inset-x-0 h-1 bg-gradient-to-b from-slate-200 to-transparent opacity-60" />

              {/* Store Header & Branding */}
              <div className="text-center space-y-1 mb-4">
                {settings.logoUrl && (
                  <div className="flex justify-center mb-2">
                    <img
                      src={settings.logoUrl}
                      alt={settings.name}
                      className="h-11 w-auto max-w-[150px] object-contain rounded filter grayscale contrast-125"
                      onError={e => {
                        (e.target as HTMLElement).style.display = 'none';
                      }}
                    />
                  </div>
                )}
                <h4 className="font-bold text-base font-sans tracking-tight text-slate-900 leading-tight">
                  {settings.name || 'AURA POS'}
                </h4>
                {settings.address && (
                  <p className="text-[11px] text-slate-600">{settings.address}</p>
                )}
                {settings.phone && (
                  <p className="text-[11px] text-slate-600">Tel: {settings.phone}</p>
                )}
                {settings.taxId && (
                  <p className="text-[10px] text-slate-500">Tax ID: {settings.taxId}</p>
                )}
                {settings.receiptHeader && (
                  <p className="text-[11px] text-slate-700 italic pt-1">{settings.receiptHeader}</p>
                )}
              </div>

              {/* Order Metadata */}
              <div className="border-t border-dashed border-slate-400 py-2 text-[11px] space-y-1">
                <div className="flex justify-between">
                  <span className="text-slate-500">Receipt #:</span>
                  <span className="font-bold text-slate-900">{sale.receiptNumber}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Date:</span>
                  <span>
                    {formatDate(sale.createdAt)} {formatTime(sale.createdAt)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Cashier:</span>
                  <span className="font-medium">{sale.employeeName}</span>
                </div>
                {sale.customerName && (
                  <div className="flex justify-between text-blue-800 font-semibold">
                    <span>Customer:</span>
                    <span>{sale.customerName}</span>
                  </div>
                )}
              </div>

              {/* Column Headers */}
              <div className="border-t border-dashed border-slate-400 py-1 flex justify-between text-[10px] font-bold text-slate-600 uppercase">
                <span>Description</span>
                <div className="flex items-center gap-4">
                  <span>Qty</span>
                  <span>Total</span>
                </div>
              </div>

              {/* Line Items */}
              <div className="border-t border-slate-200 py-2 space-y-2">
                {sale.items.map((item, idx) => (
                  <div key={idx} className="text-[11px]">
                    <div className="flex justify-between items-start gap-2">
                      <span className="font-semibold text-slate-800 flex-1 min-w-0">
                        {translateProductName(item.productId, item.productName)}
                      </span>
                      <div className="flex items-center gap-4 shrink-0 font-mono">
                        <span className="text-slate-500">{item.quantity}x</span>
                        <span className="font-bold text-slate-900">
                          {formatCurrency(item.unitPrice * item.quantity)}
                        </span>
                      </div>
                    </div>
                    {item.variantName && (
                      <p className="text-[10px] text-slate-500 italic pl-1">
                        + {item.variantName}
                      </p>
                    )}
                  </div>
                ))}
              </div>

              {/* Financial Subtotals & Taxes */}
              <div className="border-t border-dashed border-slate-400 py-2 space-y-1 text-[11px]">
                <div className="flex justify-between">
                  <span className="text-slate-600">Subtotal:</span>
                  <span className="font-mono">{formatCurrency(sale.subtotal)}</span>
                </div>
                {sale.discountAmount > 0 && (
                  <div className="flex justify-between text-emerald-700 font-semibold">
                    <span>Discount:</span>
                    <span className="font-mono">-{formatCurrency(sale.discountAmount)}</span>
                  </div>
                )}
                <div className="flex justify-between text-slate-600">
                  <span>Tax ({(sale.taxRate * 100).toFixed(1)}%):</span>
                  <span className="font-mono">{formatCurrency(sale.taxAmount)}</span>
                </div>

                <div className="border-t border-double border-slate-800 pt-2 flex justify-between text-sm font-black text-slate-900">
                  <span>TOTAL DUE:</span>
                  <span className="font-mono">{formatCurrency(sale.total)}</span>
                </div>
              </div>

              {/* Payment Methods Breakdown */}
              <div className="border-t border-dashed border-slate-400 py-2 space-y-1 text-[11px]">
                {sale.payments.map((p, idx) => (
                  <div key={idx} className="space-y-0.5">
                    <div className="flex justify-between">
                      <span className="capitalize font-semibold text-slate-700">
                        {p.method} Payment:
                      </span>
                      <span className="font-mono font-bold">{formatCurrency(p.amount)}</span>
                    </div>
                    {p.tendered !== undefined && (
                      <div className="flex justify-between text-slate-500 text-[10px]">
                        <span>Tendered:</span>
                        <span className="font-mono">{formatCurrency(p.tendered)}</span>
                      </div>
                    )}
                    {p.change !== undefined && (
                      <div className="flex justify-between text-slate-500 text-[10px]">
                        <span>Change Due:</span>
                        <span className="font-mono">{formatCurrency(p.change)}</span>
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {/* Notes */}
              {sale.notes && (
                <div className="border-t border-dashed border-slate-400 py-2 text-[10px] text-slate-600">
                  <span className="font-bold block">Notes:</span>
                  <p>{sale.notes}</p>
                </div>
              )}

              {/* Barcode & Footer */}
              <div className="border-t border-dashed border-slate-400 pt-3 text-center space-y-2">
                {/* Barcode Simulation */}
                <div className="flex flex-col items-center justify-center my-1">
                  <div className="h-8 w-44 bg-slate-900 flex items-center justify-center text-white tracking-widest text-[8px] font-mono select-none">
                    || | |||| | ||| || ||| | ||||
                  </div>
                  <span className="text-[9px] font-mono text-slate-500 mt-0.5 tracking-wider">
                    *{sale.receiptNumber}*
                  </span>
                </div>

                <p className="text-[11px] text-slate-600 font-medium">
                  {settings.receiptFooter || 'Thank you for your business! Please come again.'}
                </p>

                <p className="text-[9px] text-slate-400 tracking-wider">
                  — PREVIEW RECEIPT LAYOUT —
                </p>
              </div>
            </div>
          ) : (
            /* ESC/POS Raw Monospace Text View */
            <div className="w-full max-w-lg bg-slate-900 text-emerald-400 p-5 rounded-2xl border border-slate-800 font-mono text-xs overflow-x-auto shadow-2xl select-text">
              <div className="flex items-center justify-between pb-3 mb-3 border-b border-slate-800 text-[11px] text-slate-400">
                <span>ESC/POS Formatted Output ({paperWidth}mm / {paperWidth === 58 ? 32 : 48} Columns)</span>
                <span className="text-emerald-500 font-bold">READY</span>
              </div>
              <pre className="whitespace-pre font-mono leading-tight">{escposText}</pre>
            </div>
          )}
        </div>

        {/* Modal Footer Controls */}
        <div className="px-5 py-3.5 bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3 shrink-0">
          {/* Hardware Printer Selector */}
          <div className="flex items-center gap-2 text-xs">
            <span className="font-semibold text-slate-600 dark:text-slate-400 hidden sm:inline">
              Destination:
            </span>
            <select
              value={selectedPrinterId}
              onChange={e => setSelectedPrinterId(e.target.value)}
              className="text-xs px-2.5 py-1.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 font-medium cursor-pointer"
            >
              {availablePrinters.length > 0 ? (
                availablePrinters.map(p => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.connectionType.toUpperCase()} - {p.paperWidth}mm)
                  </option>
                ))
              ) : (
                <option value="">Standard System Receipt</option>
              )}
            </select>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleDownload}
              className="px-3 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 font-semibold text-xs flex items-center gap-1.5 transition-colors cursor-pointer"
              title="Download text file"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Download (.txt)</span>
            </button>

            <button
              type="button"
              onClick={handlePrint}
              disabled={isPrinting}
              className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 active:scale-95 text-white font-bold text-xs flex items-center gap-2 shadow-sm transition-all cursor-pointer disabled:opacity-50"
              title="Trigger printer command"
            >
              <PrinterIcon className={`w-3.5 h-3.5 ${isPrinting ? 'animate-spin' : ''}`} />
              <span>{isPrinting ? 'Sending to Printer...' : 'Print Receipt'}</span>
            </button>

            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-2 rounded-xl border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 font-medium text-xs transition-colors cursor-pointer"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
