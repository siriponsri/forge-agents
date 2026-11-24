// Official released Windows x64 portable packages, verified 2026-11-24.
// These source/asset pins do not assert full Office or Thai layout compatibility.
export const RELEASES = Object.freeze({
  wordcraft: Object.freeze({
    version: '0.18.1', sourceCommit: '079f478bd85df7bcc567e3bafa7d7219096f9c3c',
    repository: 'https://github.com/storytold/wordcraft', license: 'MIT OR Apache-2.0',
    asset: 'wordcraft-0.18.1-windows-x64-portable.zip',
    sha256: '257f670514057cb14967b88c85ac82d165da43ee7671e185acead61420af0389',
    executableSha256: '30981622793de8ef7e1bda4aa577cef104527107b1f9fc89719208ab20081211',
  }),
  pdfcraft: Object.freeze({
    version: '0.22.0', sourceCommit: 'ac140f809d554981a5276d748e6193fcf4d4bdfa',
    repository: 'https://github.com/storytold/pdfcraft', license: 'MIT OR Apache-2.0',
    asset: 'pdfcraft-0.22.0-windows-x64-portable.zip',
    sha256: '193394d15b923510e917912c0142b38119a8d4369b30693d97ef086444e9e314',
    executableSha256: '256da95e1e7450b482e48578117923f88b3d430163316f7b34296a18d83ae371',
  }),
});
export function releaseInfo(engine) {
  const pin = RELEASES[engine];
  return { ...pin, url: `${pin.repository}/releases/download/v${pin.version}/${pin.asset}`,
    releaseUrl: `${pin.repository}/releases/tag/v${pin.version}`,
    checksumUrl: `${pin.repository}/releases/download/v${pin.version}/SHA256SUMS.txt`,
    notice: 'Official unmodified package; retain upstream licenses/NOTICE and asset/font notices. ArtCraft marks are separately licensed.',
  };
}
