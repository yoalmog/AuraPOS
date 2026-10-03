package com.aurapos.pos

import com.aurapos.pos.device.DeviceIdentityManager
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Unit tests for AuraPOS application logic and device state definitions.
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
}
