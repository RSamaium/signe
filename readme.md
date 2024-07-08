# Signe

A collection of packages to manage real-time and reactive applications.

## Packages

| Package             | Description                                                                                                                                 |
|---------------------|---------------------------------------------------------------------------------------------------------------------------------------------|
| `@signe/reactive`   | Primitive usage of reactivity with `signal`, `computed`, and `effect`.                                                                      |
| `@signe/sync`       | Listens to signals within a class to synchronize with the client (if on the server-side) or, on the client-side, recreates a class from the data received from the server. Provides indication for data persistence. |
| `@signe/room`       | Creates a Room based on PartyKit for real-time applications. Can be deployed on Cloudflare.                                                 |

## Development

1. Ensure you have `pnpm` installed:
   
   ```bash
   npm install -g pnpm
   ```

2. Clone the repository:
   
   ```bash
   git clone https://github.com/RSamaium/signe
   ```

3. Install dependencies:
   
   ```bash
   pnpm install
   ```

4. Start the development server:
   
   ```bash
   pnpm run dev
   ```

## Deployment

1. Define a release:
   
   ```bash
   pnpm run release
   ```

2. Push to the master branch for deployment on NPM:
   
   ```bash
   git push origin master
   ```

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Contributing

Please read [CONTRIBUTING.md](CONTRIBUTING.md) for details on our code of conduct, and the process for submitting pull requests.

## Acknowledgments

- [PartyKit](https://partykit.dev)
- [Cloudflare](https://www.cloudflare.com)