package com.aurapos.pos

import com.aurapos.pos.device.DeviceIdentityManager
import com.aurapos.pos.hardware.BluetoothPrinterManager
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Unit tests for AuraPOS application logic, device state definitions, and hardware protocols.
 */
class POSApplicationUnitTest {

    @Test
    fun testActivationStateEnumValues() {
        val states = DeviceIdentityManager.ActivationState.values()
        assertEquals(5, states.size)
        assertTrue(states.contains(DeviceIdentityManager.ActivationState.UNREGISTERED))
        assertTrue(states.contains(DeviceIdentityManager.ActivationState.PENDING_ACTIVATION))
        assertTrue(states.contains(DeviceIdentityManager.ActivationState.ACTIVE))
        assertTrue(states.contains(DeviceIdentityManager.ActivationState.SUSPENDED))
        assertTrue(states.contains(DeviceIdentityManager.ActivationState.DECOMMISSIONED))
    }

    @Test
    fun testVersionNamingConvention() {
        val versionName = "1.0.0"
        val parts = versionName.split(".")
        assertEquals(3, parts.size)
        assertTrue(parts[0].toInt() >= 1)
    }

    @Test
    fun testHardwarePrinterTypes() {
        val printerTypes = listOf("BLUETOOTH", "USB", "NETWORK", "BUILTIN")
        assertTrue(printerTypes.contains("BLUETOOTH"))
        assertTrue(printerTypes.contains("NETWORK"))
        assertEquals(4, printerTypes.size)
    }

    @Test
    fun testX6hPacketFramingAndCrc() {
        val payload = byteArrayOf(0xE0.toByte(), 0x2E.toByte())
        val packet = BluetoothPrinterManager.buildX6Packet(0xAF.toByte(), payload)

        // Header: 0x51 0x78
        assertEquals(0x51.toByte(), packet[0])
        assertEquals(0x78.toByte(), packet[1])
        // Command: 0xAF (Set Energy)
        assertEquals(0xAF.toByte(), packet[2])
        // Reserved: 0x00
        assertEquals(0x00.toByte(), packet[3])
        // Payload Length: 2 (0x02, 0x00)
        assertEquals(0x02.toByte(), packet[4])
        assertEquals(0x00.toByte(), packet[5])
        // Payload: [0xE0, 0x2E]
        assertEquals(0xE0.toByte(), packet[6])
        assertEquals(0x2E.toByte(), packet[7])
        // CRC8
        val expectedCrc = BluetoothPrinterManager.crc8(payload)
        assertEquals(expectedCrc, packet[8])
        // Terminator: 0xFF
        assertEquals(0xFF.toByte(), packet[9])

        assertEquals(10, packet.size)
        assertTrue(BluetoothPrinterManager.isX6CatPacket(packet))
    }

    @Test
    fun testGattPropertyParsingAndStatusDescriptions() {
        val writeOnlyProps = android.bluetooth.BluetoothGattCharacteristic.PROPERTY_WRITE
        val propStringsA = BluetoothPrinterManager.getPropertyStrings(writeOnlyProps)
        assertTrue(propStringsA.contains("WRITE"))

        val writeNoRespProps = android.bluetooth.BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE
        val propStringsB = BluetoothPrinterManager.getPropertyStrings(writeNoRespProps)
        assertTrue(propStringsB.contains("WRITE_NO_RESPONSE"))

        val status0 = BluetoothPrinterManager.getGattStatusDescription(0)
        assertTrue(status0.contains("SUCCESS"))

        val status133 = BluetoothPrinterManager.getGattStatusDescription(133)
        assertTrue(status133.contains("133"))
    }
}
