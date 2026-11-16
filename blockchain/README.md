# File deployment của contract

Thư mục này chứa `FoodPrintHashRegistry.json` do repo `blockchain` sinh ra khi deploy. File không được commit sẵn; mỗi người tự copy sau khi deploy:

```bash
# từ repo blockchain
cp deployments/localhost/FoodPrintHashRegistry.json ../be/blockchain/   # Hardhat node
cp deployments/sepolia/FoodPrintHashRegistry.json ../be/blockchain/     # Sepolia
```

Đặt `BLOCKCHAIN_DEPLOYMENT_PATH=./blockchain/FoodPrintHashRegistry.json` và `BLOCKCHAIN_NETWORK` trùng mạng của file. Deploy lại thì copy lại file và cấp lại quyền Writer.
