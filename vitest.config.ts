export default {
    test: {
        coverage: {
            include: [
                'packages/**'
            ],
            exclude: [
                'packages/**/examples/**',
                'packages/**/dist/**'
            ]
        }
    }
}