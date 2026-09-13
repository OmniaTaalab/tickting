const admin = require("firebase-admin");

admin.initializeApp({
  projectId: "studio-7708718228-149dc",
});

const db = admin.firestore();

const DRY_RUN = false; // أول تشغيل خليه true

async function deleteDuplicateTickets() {
  console.log("Reading tickets...");

  const snapshot = await db.collection("tickets").get();

  const groups = new Map();

  for (const doc of snapshot.docs) {
    const data = doc.data();

    // أفضل مفتاح للدوبلكيت
    const gmailMessageId =
      data.gmailMessageId ||
      (Array.isArray(data.emailMessageIds) &&
      data.emailMessageIds.length > 0
        ? data.emailMessageIds[0]
        : null);

    if (!gmailMessageId) {
      continue;
    }

    const mailbox =
      (data.mailboxEmail || "").toLowerCase();

    const duplicateKey = gmailMessageId;

    if (!groups.has(duplicateKey)) {
      groups.set(duplicateKey, []);
    }

    groups.get(duplicateKey).push({
      ref: doc.ref,
      id: doc.id,
      data,
    });
  }

  let duplicateGroups = 0;
  let deleteCount = 0;

  for (const [key, tickets] of groups.entries()) {
    if (tickets.length <= 1) {
      continue;
    }

    duplicateGroups++;

    // خلي النسخة اللي عليها Messages أكتر
    tickets.sort((a, b) => {
      const aMessages = Array.isArray(a.data.messages)
        ? a.data.messages.length
        : 0;

      const bMessages = Array.isArray(b.data.messages)
        ? b.data.messages.length
        : 0;

      return bMessages - aMessages;
    });

    const keep = tickets[0];
    const duplicates = tickets.slice(1);

    console.log("\n==============================");
    console.log("DUPLICATE GROUP:", key);

    console.log(
      `KEEP: #${keep.data.ticketNumber} | ${keep.id}`
    );

    for (const duplicate of duplicates) {
      console.log(
        `DELETE: #${duplicate.data.ticketNumber} | ${duplicate.id}`
      );

      deleteCount++;

      if (!DRY_RUN) {
        await duplicate.ref.delete();
      }
    }
  }

  console.log("\n==============================");
  console.log(`Duplicate groups: ${duplicateGroups}`);
  console.log(`Tickets to delete: ${deleteCount}`);

  if (DRY_RUN) {
    console.log(
      "\nDRY RUN ONLY - NOTHING WAS DELETED."
    );
  } else {
    console.log(
      "\nDuplicates deleted successfully."
    );
  }
}

deleteDuplicateTickets()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("ERROR:", error);
    process.exit(1);
  });
