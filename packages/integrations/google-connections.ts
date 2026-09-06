const googleCapabilityIdList = [
  "calendar.events.read",
  "mail.school.read",
  "classroom.coursework.read",
  "drive.files.read",
] as const;

/** Keep the adapter-visible scope list read-only at runtime as well as in TS. */
export const googleCapabilityIds = Object.freeze(googleCapabilityIdList);

export type GoogleCapabilityId = (typeof googleCapabilityIds)[number];
export type ConnectionPhase =
  | "disconnected"
  | "authorization-pending"
  | "connected"
  | "degraded"
  | "blocked"
  | "reconnect-required";
export type PermissionState =
  | "not-requested"
  | "authorization-pending"
  | "authorized"
  | "permission-denied"
  | "admin-blocked"
  | "unavailable";

export type GoogleCapability = {
  id: GoogleCapabilityId;
  name: string;
  fallback: string;
};

export type GoogleConnection = {
  id: string;
  provider: "google";
  kind: "personal" | "school";
  label: string;
  email: string;
  phase: ConnectionPhase;
  permissions: Record<GoogleCapabilityId, PermissionState>;
  updatedAt: string;
  /** This boundary stores no OAuth credentials and cannot claim working sync. */
  implementation: {
    authorization: "adapter-required";
    sync: "not-implemented";
  };
};

export type GoogleConnections = { identities: GoogleConnection[] };

export type AuthorizationOutcome = {
  capability: GoogleCapabilityId;
  result: "authorized" | "permission-denied" | "admin-blocked" | "unavailable";
};

const authorizationResults = [
  "authorized",
  "permission-denied",
  "admin-blocked",
  "unavailable",
] as const;

export type GoogleConnectionCommand =
  | {
      type: "identity.add";
      identity: Pick<GoogleConnection, "id" | "kind" | "label" | "email">;
    }
  | {
      type: "connection.connect";
      identityId: string;
      capabilities: GoogleCapabilityId[];
    }
  | {
      type: "connection.reconnect";
      identityId: string;
      capabilities: GoogleCapabilityId[];
    }
  | {
      type: "authorization.resolve";
      identityId: string;
      outcomes: AuthorizationOutcome[];
    }
  | { type: "connection.expire"; identityId: string }
  | { type: "connection.disconnect"; identityId: string };

const capabilityCatalog: GoogleCapability[] = [
  {
    id: "calendar.events.read",
    name: "Calendar events",
    fallback: "Capture the event or add the task manually.",
  },
  {
    id: "mail.school.read",
    name: "School-related mail",
    fallback: "Paste the relevant teacher message into Capture.",
  },
  {
    id: "classroom.coursework.read",
    name: "Classroom coursework",
    fallback: "Open Classroom normally and capture visible work.",
  },
  {
    id: "drive.files.read",
    name: "Drive files",
    fallback: "Import a supported file or paste the relevant content.",
  },
];

export function googleCapabilities(): GoogleCapability[] {
  return capabilityCatalog.map((capability) => ({ ...capability }));
}

export function emptyGoogleConnections(): GoogleConnections {
  return { identities: [] };
}

/**
 * Pure connection-state boundary. A future trusted adapter supplies explicit
 * authorization outcomes; this module never starts OAuth or performs sync.
 */
export function updateGoogleConnections(
  current: GoogleConnections,
  command: GoogleConnectionCommand,
  now: Date,
): GoogleConnections {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime()))
    throw new RangeError("Invalid connection time.");
  const at = now.toISOString();

  if (command.type === "identity.add") {
    const identity = validateIdentity(command.identity);
    if (
      current.identities.some(
        (item) =>
          item.id === identity.id ||
          item.email.toLowerCase() === identity.email.toLowerCase(),
      )
    )
      throw Error("That Google identity already exists.");
    return {
      identities: [
        ...current.identities,
        {
          ...identity,
          provider: "google",
          phase: "disconnected",
          permissions: initialPermissions(),
          updatedAt: at,
          implementation: {
            authorization: "adapter-required",
            sync: "not-implemented",
          },
        },
      ],
    };
  }

  const index = current.identities.findIndex(
    ({ id }) => id === command.identityId,
  );
  if (index < 0) throw Error("Google identity not found.");
  const existing = current.identities[index]!;
  const connection: GoogleConnection = {
    ...existing,
    permissions: { ...existing.permissions },
    updatedAt: at,
  };

  if (command.type === "connection.connect") {
    if (["reconnect-required", "blocked"].includes(connection.phase))
      throw Error("This Google identity must reconnect.");
    beginAuthorization(connection, command.capabilities, false);
  }

  if (command.type === "connection.reconnect") {
    if (
      !["reconnect-required", "blocked", "degraded"].includes(connection.phase)
    )
      throw Error("This Google identity does not need to reconnect.");
    beginAuthorization(connection, command.capabilities, true);
  }

  if (command.type === "authorization.resolve") {
    const pending = googleCapabilityIds.filter(
      (id) => connection.permissions[id] === "authorization-pending",
    );
    const outcomes = validateAuthorizationOutcomes(command.outcomes);
    const outcomeCapabilities = uniqueCapabilities(
      outcomes.map(({ capability }) => capability),
    );
    if (
      pending.length !== outcomeCapabilities.length ||
      pending.some((capability) => !outcomeCapabilities.includes(capability))
    )
      throw Error(
        "Authorization outcomes must resolve every pending capability.",
      );
    for (const outcome of outcomes)
      connection.permissions[outcome.capability] = outcome.result;
    connection.phase = phaseFromPermissions(connection.permissions);
  }

  if (command.type === "connection.expire") {
    if (!["connected", "degraded"].includes(connection.phase))
      throw Error("Only an active Google connection can expire.");
    connection.phase = "reconnect-required";
  }

  if (command.type === "connection.disconnect") {
    connection.phase = "disconnected";
    connection.permissions = initialPermissions();
  }

  return {
    identities: current.identities.map((item, itemIndex) =>
      itemIndex === index ? connection : item,
    ),
  };
}

function beginAuthorization(
  connection: GoogleConnection,
  requested: GoogleCapabilityId[],
  retry: boolean,
) {
  const capabilities = uniqueCapabilities(requested);
  if (!capabilities.length)
    throw Error("Request at least one Google capability.");
  if (
    !retry &&
    capabilities.length === googleCapabilityIds.length &&
    googleCapabilityIds.every(
      (id) => connection.permissions[id] === "not-requested",
    )
  )
    throw Error("Request Google capabilities progressively.");
  if (
    googleCapabilityIds.some(
      (id) => connection.permissions[id] === "authorization-pending",
    )
  )
    throw Error("A Google permission request is already pending.");
  const eligible = capabilities.filter(
    (id) => retry || connection.permissions[id] !== "authorized",
  );
  if (!eligible.length)
    throw Error("Those Google capabilities are already authorized.");
  for (const capability of eligible)
    connection.permissions[capability] = "authorization-pending";
  connection.phase = "authorization-pending";
}

function uniqueCapabilities(capabilities: unknown): GoogleCapabilityId[] {
  if (!Array.isArray(capabilities))
    throw Error("Google capabilities must be an array.");
  const normalized = capabilities.map((capability) => {
    if (
      typeof capability !== "string" ||
      !googleCapabilityIds.some((known) => known === capability)
    )
      throw Error("Unknown Google capability.");
    return capability as GoogleCapabilityId;
  });
  const unique = [...new Set(normalized)];
  if (unique.length !== normalized.length)
    throw Error("Google capabilities must be unique.");
  return unique;
}

function validateAuthorizationOutcomes(
  outcomes: unknown,
): AuthorizationOutcome[] {
  if (!Array.isArray(outcomes) || outcomes.length === 0)
    throw Error("Provide at least one authorization outcome.");
  return outcomes.map((outcome) => {
    if (!outcome || typeof outcome !== "object")
      throw Error("Invalid Google authorization outcome.");
    const value = outcome as Record<string, unknown>;
    if (
      typeof value.capability !== "string" ||
      !googleCapabilityIds.some((known) => known === value.capability)
    )
      throw Error("Unknown Google capability.");
    if (
      typeof value.result !== "string" ||
      !authorizationResults.some((known) => known === value.result)
    )
      throw Error("Unknown Google authorization result.");
    return {
      capability: value.capability as GoogleCapabilityId,
      result: value.result as AuthorizationOutcome["result"],
    };
  });
}

function phaseFromPermissions(
  permissions: Record<GoogleCapabilityId, PermissionState>,
): ConnectionPhase {
  const states = Object.values(permissions);
  const authorized = states.includes("authorized");
  const blocked = states.some((state) =>
    ["permission-denied", "admin-blocked", "unavailable"].includes(state),
  );
  if (authorized && blocked) return "degraded";
  if (authorized) return "connected";
  if (blocked) return "blocked";
  return "disconnected";
}

function initialPermissions(): Record<GoogleCapabilityId, PermissionState> {
  return Object.fromEntries(
    googleCapabilityIds.map((id) => [id, "not-requested"]),
  ) as Record<GoogleCapabilityId, PermissionState>;
}

function validateIdentity(
  identity: unknown,
): Pick<GoogleConnection, "id" | "kind" | "label" | "email"> {
  if (!identity || typeof identity !== "object")
    throw Error("Google identity is invalid.");
  const input = identity as Record<string, unknown>;
  if (
    typeof input.id !== "string" ||
    typeof input.label !== "string" ||
    typeof input.email !== "string"
  )
    throw Error("Google identity is invalid.");
  const value = {
    id: input.id.trim(),
    kind: input.kind,
    label: input.label.trim(),
    email: input.email.trim(),
  };
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(value.id))
    throw Error("Google identity ID is invalid.");
  if (value.kind !== "personal" && value.kind !== "school")
    throw Error("Google identity kind is invalid.");
  if (!value.label || value.label.length > 100)
    throw Error("Google identity label is invalid.");
  if (
    value.email.length > 320 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.email)
  )
    throw Error("Google identity email is invalid.");
  return {
    id: value.id,
    kind: value.kind as GoogleConnection["kind"],
    label: value.label,
    email: value.email,
  };
}
