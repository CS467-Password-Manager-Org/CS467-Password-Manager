import {
  type CreateVaultItemRequest,
  type LoginRequest,
  type LoginResponse,
  type MeResponse,
  type RegisterRequest,
  type RegisterResponse,
  type SaltResponse,
  type UpdateVaultItemRequest,
  type VaultItem,
  type VaultItemListResponse,
} from '@app/shared';
import { bytesToBase64 } from '@app/crypto';

export type ServerResponse<T> = {
  data: T;
  publicErrorMessage: string;
};

const DEFAULT_SERVER_ERROR = 'Unable to reach the server. Please try again later.';

const DEFAULT_LOGIN_ERROR = 'Error logging in.';

export async function fetchUserSalt(email: string): Promise<ServerResponse<SaltResponse | null>> {
  const url = `/api/v1/auth/salt?email=${encodeURIComponent(email)}`;

  try {
    const response = await fetch(url);

    if (!response.ok) {
      let publicMessage = DEFAULT_LOGIN_ERROR;

      if (response.status >= 500 && response.status < 600) {
        publicMessage = DEFAULT_SERVER_ERROR;
      }

      return {
        data: null,
        publicErrorMessage: publicMessage,
      };
    }

    const responseBody = await response.json();
    if (!responseBody.salt) {
      console.error(response);
      return {
        data: null,
        publicErrorMessage: DEFAULT_LOGIN_ERROR,
      };
    }

    return {
      data: responseBody,
      publicErrorMessage: '',
    };
  } catch (error) {
    console.error(error);
    return {
      data: null,
      publicErrorMessage: DEFAULT_LOGIN_ERROR,
    };
  }
}

const DEFAULT_REGISTER_ERROR = 'Error registering.';

export async function registerNewEmail(
  email: string,
  authKey: Uint8Array,
  salt: Uint8Array,
): Promise<ServerResponse<RegisterResponse | null>> {
  const url = '/api/v1/auth/register';

  const body: RegisterRequest = {
    email,
    authKey: bytesToBase64(authKey),
    salt: bytesToBase64(salt),
  };

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      console.error(response);

      let publicMessage = DEFAULT_REGISTER_ERROR;

      if (response.status == 409) {
        publicMessage = 'This email address is already registered.';
      } else if (response.status >= 500 && response.status < 600) {
        publicMessage = DEFAULT_SERVER_ERROR;
      }

      return {
        data: null,
        publicErrorMessage: publicMessage,
      };
    }

    const responseBody = await response.json();
    if (!responseBody.id || !responseBody.email) {
      console.error('Invalid response: ', response);
      return {
        data: null,
        publicErrorMessage: DEFAULT_REGISTER_ERROR,
      };
    }

    return {
      data: responseBody,
      publicErrorMessage: '',
    };
  } catch (error) {
    console.error(error);
    return {
      data: null,
      publicErrorMessage: DEFAULT_REGISTER_ERROR,
    };
  }
}

export async function login(
  email: string,
  authKey: string,
): Promise<ServerResponse<LoginResponse | null>> {
  const url = '/api/v1/auth/login';

  const body: LoginRequest = {
    email,
    authKey,
  };

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      let publicMessage = DEFAULT_LOGIN_ERROR;

      if (response.status >= 500 && response.status < 600) {
        publicMessage = DEFAULT_SERVER_ERROR;
      }

      return {
        data: null,
        publicErrorMessage: publicMessage,
      };
    }

    const responseJson = await response.json();
    if (!responseJson.token) {
      console.error('Invalid response: ', response);
      return {
        data: null,
        publicErrorMessage: DEFAULT_LOGIN_ERROR,
      };
    }

    return {
      data: responseJson,
      publicErrorMessage: '',
    };
  } catch (error) {
    console.error(error);
    return {
      data: null,
      publicErrorMessage: DEFAULT_LOGIN_ERROR,
    };
  }
}

const DEFAULT_ME_ERROR = 'Error fetching account details.';

export async function fetchMe(): Promise<ServerResponse<MeResponse | null>> {
  const url = '/api/v1/auth/me';

  const token = sessionStorage.getItem('token');
  if (!token) {
    return {
      data: null,
      publicErrorMessage: DEFAULT_ME_ERROR,
    };
  }

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      console.error(response);
      return {
        data: null,
        publicErrorMessage: DEFAULT_ME_ERROR,
      };
    }

    const responseBody: MeResponse = await response.json();
    if (!responseBody.email) {
      console.error('Invalid response: ', response);
      return {
        data: null,
        publicErrorMessage: DEFAULT_ME_ERROR,
      };
    }

    return {
      data: responseBody,
      publicErrorMessage: '',
    };
  } catch (error) {
    console.error(error);
    return {
      data: null,
      publicErrorMessage: DEFAULT_ME_ERROR,
    };
  }
}

const DEFAULT_VAULT_ITEMS_ERROR = 'Error fetching passwords.';

export async function fetchVaultItems(): Promise<ServerResponse<VaultItem[] | null>> {
  const url = '/api/v1/vault/items';

  const token = sessionStorage.getItem('token');
  if (!token) {
    return {
      data: null,
      publicErrorMessage: DEFAULT_VAULT_ITEMS_ERROR,
    };
  }

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      console.error(response);
      return {
        data: null,
        publicErrorMessage: DEFAULT_VAULT_ITEMS_ERROR,
      };
    }

    const responseBody: VaultItemListResponse = await response.json();
    if (!responseBody.items) {
      console.error('Invalid response: ', response);
      return {
        data: null,
        publicErrorMessage: DEFAULT_VAULT_ITEMS_ERROR,
      };
    }

    return {
      data: responseBody.items,
      publicErrorMessage: '',
    };
  } catch (error) {
    console.error(error);
    return {
      data: null,
      publicErrorMessage: DEFAULT_VAULT_ITEMS_ERROR,
    };
  }
}

const DEFAULT_CREATE_VAULT_ITEM_ERROR = 'Error saving password.';

export async function createVaultItem(
  encryptedData: string,
): Promise<ServerResponse<VaultItem | null>> {
  const url = '/api/v1/vault/items';

  const token = sessionStorage.getItem('token');
  if (!token) {
    return {
      data: null,
      publicErrorMessage: DEFAULT_CREATE_VAULT_ITEM_ERROR,
    };
  }

  const body: CreateVaultItemRequest = { encryptedData };

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      console.error(response);
      return {
        data: null,
        publicErrorMessage: DEFAULT_CREATE_VAULT_ITEM_ERROR,
      };
    }

    const responseBody: VaultItem = await response.json();
    if (!responseBody.id || !responseBody.encryptedData) {
      console.error('Invalid response: ', response);
      return {
        data: null,
        publicErrorMessage: DEFAULT_CREATE_VAULT_ITEM_ERROR,
      };
    }

    return {
      data: responseBody,
      publicErrorMessage: '',
    };
  } catch (error) {
    console.error(error);
    return {
      data: null,
      publicErrorMessage: DEFAULT_CREATE_VAULT_ITEM_ERROR,
    };
  }
}

const DEFAULT_UPDATE_VAULT_ITEM_ERROR = 'Error updating password.';

export async function updateVaultItem(
  id: string,
  encryptedData: string,
): Promise<ServerResponse<VaultItem | null>> {
  const url = `/api/v1/vault/items/${encodeURIComponent(id)}`;

  const token = sessionStorage.getItem('token');
  if (!token) {
    return {
      data: null,
      publicErrorMessage: DEFAULT_UPDATE_VAULT_ITEM_ERROR,
    };
  }

  const body: UpdateVaultItemRequest = { encryptedData };

  try {
    const response = await fetch(url, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      console.error(response);
      return {
        data: null,
        publicErrorMessage: DEFAULT_UPDATE_VAULT_ITEM_ERROR,
      };
    }

    const responseBody: VaultItem = await response.json();
    if (!responseBody.id || !responseBody.encryptedData) {
      console.error('Invalid response: ', response);
      return {
        data: null,
        publicErrorMessage: DEFAULT_UPDATE_VAULT_ITEM_ERROR,
      };
    }

    return {
      data: responseBody,
      publicErrorMessage: '',
    };
  } catch (error) {
    console.error(error);
    return {
      data: null,
      publicErrorMessage: DEFAULT_UPDATE_VAULT_ITEM_ERROR,
    };
  }
}

const DEFAULT_DELETE_VAULT_ITEM_ERROR = 'Error deleting password.';

export async function deleteVaultItem(id: string): Promise<ServerResponse<null>> {
  const url = `/api/v1/vault/items/${encodeURIComponent(id)}`;

  const token = sessionStorage.getItem('token');
  if (!token) {
    return {
      data: null,
      publicErrorMessage: DEFAULT_DELETE_VAULT_ITEM_ERROR,
    };
  }

  try {
    const response = await fetch(url, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (!response.ok) {
      console.error(response);
      return {
        data: null,
        publicErrorMessage: DEFAULT_DELETE_VAULT_ITEM_ERROR,
      };
    }

    return {
      data: null,
      publicErrorMessage: '',
    };
  } catch (error) {
    console.error(error);
    return {
      data: null,
      publicErrorMessage: DEFAULT_DELETE_VAULT_ITEM_ERROR,
    };
  }
}
