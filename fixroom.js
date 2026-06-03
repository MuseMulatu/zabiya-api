cat << 'EOF' > fix-room.js
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function fix() {
  const roomId = "6a1feaefd63b6068ded6fb78"; // 🚨 PASTE YOUR 100MS ROOM ID HERE
  const driverUid = "G0OxSrFbgPViIk90xsV4UPffOX33";

  console.log("Looking up driver...");
  const driver = await prisma.nestUser.findUnique({ 
      where: { firebaseUid: driverUid }, 
      include: { driverProfile: true } 
  });

  console.log("Injecting Room ID into the database...");
  
  // Inject the room ID into the active route subscription
  await prisma.routeSubscription.updateMany({
    where: { driverId: driver.driverProfile.id },
    data: { hmsRoomId: roomId } // 🚨 Change 'roomId' if your schema uses a different column name
  });

  console.log("✅ Room ID successfully attached to the Route!");
}

fix().catch(console.error).finally(() => prisma.$disconnect());
EOF