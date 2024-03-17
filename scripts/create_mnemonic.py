import os
from mnemonic import Mnemonic
import bech32

# Your Bech32-encoded string
bech32_encoded = os.getenv('BECH32_PRIV_KEY')

# Decode the Bech32 string to get the human-readable part (hrp) and the data part
hrp, data = bech32.bech32_decode(bech32_encoded)

# Convert the 5-bit array data to 8-bit bytes
data_bytes = bech32.convertbits(data, 5, 8, False)

if data_bytes is not None:
    # Assuming the padding or non-entropy data is at the beginning and its length
    # You need to know the length of the padding to remove it accurately
    padding_length = 1  # Example: 1 byte of padding. Adjust this based on your actual padding length
    
    # Remove the padding from the beginning
    adjusted_data_bytes = bytes(data_bytes[padding_length:])

    # Convert the adjusted byte array to a hexadecimal string (optional, for verification)
    private_key_hex = bytes(adjusted_data_bytes).hex()
    print("Hexadecimal string without padding:", private_key_hex)

    # Initialize the Mnemonic class (using English word list)
    mnemo = Mnemonic("english")

    # Generate mnemonic from the adjusted private key bytes
    mnemonic = mnemo.to_mnemonic(adjusted_data_bytes)

    print("Mnemonic:", mnemonic)
else:
    print("Conversion from Bech32 data to bytes failed.")
